import { EventBus, EventTopic, EventMessage } from '@agent-infra/event-bus';
import { GuardrailOrchestrator } from './orchestrator/guardrail-orchestrator';

async function main() {
    const bus = new EventBus();
    const orchestrator = new GuardrailOrchestrator();

    await bus.connect();
    console.log('[EnforcementService] Connected to Event Bus');

    // Subscribe to IDENTITY_VERIFIED (Chain: ActionRequest -> IdentityVerified -> EnforcementResult)
    await bus.subscribe(EventTopic.IDENTITY_VERIFIED, async (msg: EventMessage) => {
        console.log(`[EnforcementService] Identity Verified for: ${msg.correlationId}. Performing Enforcement...`);

        try {
            const { agent_id, action_id, action_type, payload } = msg.payload;

            const context = await orchestrator.coordinate(agent_id, action_type, payload, {
                actionId: action_id || `act-${msg.correlationId.split('-')[0]}`
            });

            const status = context.status === 'COMPLETED' ? 'PERMITTED' : 'BLOCKED';
            console.log(`[EnforcementService] Action ${msg.correlationId} evaluation: ${status}`);

            if (status === 'BLOCKED') {
                await bus.publish(
                    EventTopic.SAFETY_LOOP_RESULT,
                    { status: 'DENIED', reason: 'Blocked by guardrail policy' },
                    msg.correlationId,
                    'enforcement_service'
                );
            } else {
                // Publish result to Simulation Layer
                await bus.publish(
                    EventTopic.ENFORCEMENT_RESULT,
                    {
                        status,
                        agent_id,
                        action_id,
                        action_type,
                        payload,
                        decision: context.decisionExplanations[0]?.summary || 'Action processed by guardrails',
                        violations: context.violations
                    },
                    msg.correlationId,
                    'enforcement_service'
                );
            }
        } catch (err) {
            console.error(`[EnforcementService] Error processing action ${msg.correlationId}:`, err);
            await bus.publish(
                EventTopic.SAFETY_LOOP_RESULT,
                { status: 'DENIED', error: String(err) },
                msg.correlationId,
                'enforcement_service'
            );
        }
    });

    await bus.subscribe(EventTopic.ACTION_REQUESTED, async (msg: EventMessage) => {
        console.log(`[EnforcementService] Received Action Request ${msg.correlationId}. Waiting for Identity Check...`);
    });
}

main().catch(console.error);

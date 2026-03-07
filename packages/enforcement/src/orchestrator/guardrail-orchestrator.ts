import { ActionContext, EnforcementState, Violation, Intervention } from '../core/models';
import { EnforcementEventBus, EnforcementEvents } from '../core/event-bus';
import { PreExecutionLayer } from '../layers/pre-execution/pre-execution-layer';
import { InProcessLayer } from '../layers/in-process/in-process-layer';
import { PostExecutionLayer } from '../layers/post-execution/post-execution-layer';
import { AdaptiveInterventionLayer } from '../layers/intervention/adaptive-intervention-layer';
import { appendDecisionExplanation } from '../core/decision-log';

export class GuardrailOrchestrator {
    private eventBus: EnforcementEventBus;
    private preExecution: PreExecutionLayer;
    private inProcess: InProcessLayer;
    private postExecution: PostExecutionLayer;
    private interventionLayer: AdaptiveInterventionLayer;
    private activeActions: Map<string, ActionContext> = new Map();

    constructor() {
        this.eventBus = EnforcementEventBus.getInstance();
        this.preExecution = new PreExecutionLayer();
        this.inProcess = new InProcessLayer();
        this.postExecution = new PostExecutionLayer();
        this.interventionLayer = new AdaptiveInterventionLayer();

        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        this.eventBus.on(EnforcementEvents.VIOLATION_DETECTED, async ({ actionId, violation }: { actionId: string, violation: Violation }) => {
            console.warn(`[Orchestrator] Violation detected for action ${actionId}: ${violation.description} (${violation.severity})`);
            const context = this.activeActions.get(actionId);
            if (context) {
                // Ensure violation is in the context
                if (!context.violations.find(v => v.id === violation.id)) {
                    context.violations.push(violation);
                }

                // Trigger adaptive intervention immediately when violation is detected
                await this.interventionLayer.process(context);

                if (violation.severity === 'CRITICAL') {
                    console.error(`[Orchestrator] Critical violation! Action ${actionId} state is now ${context.status}`);
                }
            }
        });

        this.eventBus.on(EnforcementEvents.REMEDIATION_TRIGGERED, (context: ActionContext) => {
            console.log(`[Orchestrator] Remediation in progress for action ${context.actionId}`);
        });

        this.eventBus.on(EnforcementEvents.REMEDIATION_COMPLETED, (context: ActionContext) => {
            const rollbackCount = context.remediationReport?.rollbackTransactions.length ?? 0;
            console.log(`[Orchestrator] Remediation completed for action ${context.actionId}. Rollback transactions: ${rollbackCount}`);
        });
    }

    public async coordinate(
        agentId: string,
        intent: string,
        params: Record<string, any>,
        options?: { actionId?: string }
    ): Promise<ActionContext> {
        const actionId = options?.actionId || `act-${Date.now()}`;
        let context: ActionContext = {
            actionId,
            agentId,
            intent,
            params,
            startTime: new Date(),
            status: EnforcementState.PENDING,
            violations: [],
            interventions: [],
            decisionExplanations: [],
            systemChanges: Array.isArray(params.systemChanges) ? params.systemChanges : undefined,
            stakeholders: Array.isArray(params.stakeholders) ? params.stakeholders : undefined,
            trustCoefficient: typeof params.trustCoefficient === 'number' ? params.trustCoefficient : 1.0
        };

        appendDecisionExplanation(context, {
            layer: 'PRE_EXECUTION',
            component: 'GuardrailOrchestrator',
            outcome: 'HOLD',
            summary: 'Action submitted for guardrail coordination.',
            rationale: [
                `Received action ${actionId} from agent ${agentId}.`,
                'Execution will proceed through pre-execution, in-process, and post-execution layers.'
            ],
            evidence: { intent, hasParams: Object.keys(params || {}).length > 0 }
        });

        this.activeActions.set(actionId, context);
        this.eventBus.emit(EnforcementEvents.ACTION_PROPOSED, context);

        try {
            // 1. Pre-Execution
            context = await this.preExecution.process(context);
            if (context.status === EnforcementState.PRE_EXECUTION_FAILED) {
                return context;
            }

            // 2. In-Process
            context = await this.inProcess.process(context);
            if (context.status === EnforcementState.SUSPENDED) {
                context.endTime = new Date();
                return context;
            }

            // Simulate execution time
            await new Promise(resolve => setTimeout(resolve, 500));

            context.endTime = new Date();
            context.status = EnforcementState.COMPLETED;
            this.eventBus.emit(EnforcementEvents.ACTION_COMPLETED, context);
            appendDecisionExplanation(context, {
                layer: 'IN_PROCESS',
                component: 'GuardrailOrchestrator',
                outcome: 'EXECUTE',
                summary: 'Action execution completed and moved to post-execution audit.',
                rationale: [
                    'In-process monitoring did not leave action in suspended state.',
                    'Post-execution audit is required before final disposition.'
                ],
                evidence: { actionId: context.actionId, status: context.status }
            });

            // 3. Post-Execution
            context = await this.postExecution.process(context);

            return context;
        } finally {
            this.activeActions.delete(actionId);
        }
    }

    public getActiveContext(actionId: string): ActionContext | undefined {
        return this.activeActions.get(actionId);
    }
}

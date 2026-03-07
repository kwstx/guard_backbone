import { BaseEnforcementLayer } from '../base-layer';
import { ActionContext, EnforcementState, ViolationCategory, ViolationSeverity } from '../../core/models';
import { EnforcementEvents } from '../../core/event-bus';
import { RemediationEngine } from '../remediation/remediation-engine';
import { appendDecisionExplanation } from '../../core/decision-log';

export class PostExecutionLayer extends BaseEnforcementLayer {
    private remediationEngine: RemediationEngine;

    constructor() {
        super();
        this.remediationEngine = new RemediationEngine();
    }

    getName(): string {
        return 'PostExecutionAuditing';
    }

    async process(context: ActionContext): Promise<ActionContext> {
        this.eventBus.emit(EnforcementEvents.AUDIT_STARTED, context);

        console.log(`[${this.getName()}] Auditing results for action: ${context.actionId}`);

        // Simulate auditing logic
        const hasCriticalViolation = context.violations.some(v => v.severity === ViolationSeverity.CRITICAL);

        if (hasCriticalViolation || context.params.invalidResult) {
            const violation = {
                id: `v-post-${Date.now()}`,
                timestamp: new Date(),
                category: ViolationCategory.COMPLIANCE,
                severity: ViolationSeverity.CRITICAL,
                description: 'Final result fails compliance audit.',
                sourceLayer: this.getName(),
                metadata: { invalidResult: context.params.invalidResult }
            };

            context.violations.push(violation);
            context.status = EnforcementState.AUDIT_FAILED;
            appendDecisionExplanation(context, {
                layer: 'POST_EXECUTION',
                component: this.getName(),
                outcome: 'AUDIT_FAIL',
                summary: 'Post-execution audit failed and triggered remediation.',
                rationale: [
                    hasCriticalViolation
                        ? 'Critical violation already present in action context.'
                        : 'Invalid result flag was present in execution output.',
                    'Compliance policy requires remediation workflow on audit failure.'
                ],
                evidence: { violationId: violation.id, invalidResult: context.params.invalidResult === true }
            });
            this.eventBus.emitViolation(context.actionId, violation);

            // Auto-remediation trigger
            await this.triggerRemediation(context);
        } else {
            context.status = EnforcementState.AUDIT_PASSED;
            appendDecisionExplanation(context, {
                layer: 'POST_EXECUTION',
                component: this.getName(),
                outcome: 'AUDIT_PASS',
                summary: 'Post-execution audit passed.',
                rationale: [
                    'No critical violation and no invalid result marker were detected.',
                    'Action is compliant after final review.'
                ],
                evidence: { status: context.status }
            });
        }

        this.eventBus.emit(EnforcementEvents.AUDIT_COMPLETED, context);
        return context;
    }

    private async triggerRemediation(context: ActionContext) {
        console.log(`[${this.getName()}] Starting automatic remediation for violation...`);
        this.eventBus.emit(EnforcementEvents.REMEDIATION_TRIGGERED, context);
        await this.remediationEngine.remediate(context);
        this.eventBus.emit(EnforcementEvents.REMEDIATION_COMPLETED, context);
    }
}

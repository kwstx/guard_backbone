import { BaseEnforcementLayer } from '../base-layer';
import { ActionContext, EnforcementState, ViolationCategory, ViolationSeverity } from '../../core/models';
import { EnforcementEvents } from '../../core/event-bus';
import { PredictiveRiskEngine } from './predictive-risk-engine';
import { appendDecisionExplanation } from '../../core/decision-log';

export class PreExecutionLayer extends BaseEnforcementLayer {
    private riskEngine: PredictiveRiskEngine;

    constructor() {
        super();
        this.riskEngine = new PredictiveRiskEngine();
    }

    getName(): string {
        return 'PreExecutionValidation';
    }

    async process(context: ActionContext): Promise<ActionContext> {
        this.eventBus.emit(EnforcementEvents.PRE_EXECUTION_STARTED, context);

        console.log(`[${this.getName()}] Validating intent: ${context.intent}`);

        // 1. Predictive Risk Analysis
        const riskProfile = await this.riskEngine.evaluate(context);
        context.riskProfile = riskProfile;
        context.predictedBehaviorVector = this.riskEngine.predictBehaviorVector(context);
        appendDecisionExplanation(context, {
            layer: 'PRE_EXECUTION',
            component: 'PredictiveRiskEngine',
            outcome: riskProfile.recommendation === 'BLOCK' ? 'BLOCK' : riskProfile.recommendation === 'HOLD' ? 'HOLD' : 'PASS',
            summary: `Predictive risk recommendation: ${riskProfile.recommendation}.`,
            rationale: [
                `Overall risk score was ${riskProfile.overallRiskScore.toFixed(2)}.`,
                `Generated ${riskProfile.synergyShifts.length} synergy shifts, ${riskProfile.propagationEffects.length} propagation effects, and ${riskProfile.policyForecasts.length} policy forecasts.`
            ],
            evidence: {
                riskScore: riskProfile.overallRiskScore,
                recommendation: riskProfile.recommendation,
                consequences: riskProfile.realWorldConsequences
            }
        });

        if (riskProfile.recommendation === 'BLOCK') {
            const violation = {
                id: `v-risk-${Date.now()}`,
                timestamp: new Date(),
                category: ViolationCategory.IMPACT,
                severity: ViolationSeverity.CRITICAL,
                description: `Action blocked by Predictive Risk Engine. Overall Risk: ${riskProfile.overallRiskScore.toFixed(2)}. ${riskProfile.realWorldConsequences.join(' ')}`,
                sourceLayer: this.getName(),
                metadata: { riskProfile }
            };

            context.violations.push(violation);
            context.status = EnforcementState.PRE_EXECUTION_FAILED;
            appendDecisionExplanation(context, {
                layer: 'PRE_EXECUTION',
                component: this.getName(),
                outcome: 'BLOCK',
                summary: 'Action blocked during pre-execution due to critical predictive risk.',
                rationale: [
                    'PredictiveRiskEngine returned BLOCK recommendation.',
                    'Critical impact violation was generated to prevent unsafe execution.'
                ],
                evidence: { violationId: violation.id, severity: violation.severity }
            });
            this.eventBus.emitViolation(context.actionId, violation);
            return context;
        }

        if (riskProfile.recommendation === 'HOLD') {
            const violation = {
                id: `v-warn-${Date.now()}`,
                timestamp: new Date(),
                category: ViolationCategory.IMPACT,
                severity: ViolationSeverity.HIGH,
                description: `Heuristic warning: Elevated risk detected (${riskProfile.overallRiskScore.toFixed(2)}). Manual review suggested.`,
                sourceLayer: this.getName(),
                metadata: { riskProfile }
            };
            context.violations.push(violation);
            appendDecisionExplanation(context, {
                layer: 'PRE_EXECUTION',
                component: this.getName(),
                outcome: 'WARN',
                summary: 'Elevated risk detected; execution allowed with warning.',
                rationale: [
                    'PredictiveRiskEngine returned HOLD recommendation.',
                    'Violation was logged for downstream intervention and audit visibility.'
                ],
                evidence: { violationId: violation.id, severity: violation.severity }
            });
            // We don't necessarily fail here, but we could if that's the policy.
            // For now, let's proceed but with violations recorded.
        }

        // 2. Baseline validation logic
        if (context.params.unauthorized) {
            const violation = {
                id: `v-pre-${Date.now()}`,
                timestamp: new Date(),
                category: ViolationCategory.PERMISSION,
                severity: ViolationSeverity.HIGH,
                description: 'Unauthorized parameter detected in pre-execution.',
                sourceLayer: this.getName(),
                metadata: { param: 'unauthorized' }
            };

            context.violations.push(violation);
            context.status = EnforcementState.PRE_EXECUTION_FAILED;
            appendDecisionExplanation(context, {
                layer: 'PRE_EXECUTION',
                component: this.getName(),
                outcome: 'BLOCK',
                summary: 'Action blocked due to explicit unauthorized pre-execution parameter.',
                rationale: [
                    'Input params contained an unauthorized marker.',
                    'Policy requires immediate pre-execution failure for authorization violations.'
                ],
                evidence: { violationId: violation.id, param: 'unauthorized' }
            });
            this.eventBus.emitViolation(context.actionId, violation);
        } else {
            context.status = EnforcementState.PRE_EXECUTION_PASSED;
            appendDecisionExplanation(context, {
                layer: 'PRE_EXECUTION',
                component: this.getName(),
                outcome: 'PASS',
                summary: 'Pre-execution checks passed; action may proceed to execution monitoring.',
                rationale: [
                    'No blocking risk recommendation remained after predictive evaluation.',
                    'No explicit authorization violation was detected in request parameters.'
                ],
                evidence: { status: context.status }
            });
        }

        this.eventBus.emit(EnforcementEvents.PRE_EXECUTION_COMPLETED, context);
        return context;
    }
}

import {
    ActionContext,
    ExecutionStep,
    InProcessMonitorPolicy,
    Violation,
    ViolationCategory,
    ViolationSeverity,
    EnforcementState
} from '../../core/models';
import { EnforcementEventBus, EnforcementEvents } from '../../core/event-bus';
import { AnomalyDetectionEngine } from './anomaly-detection-engine';
import { ViolationPropagationModule } from '../../core/violation-propagation';
import { appendDecisionExplanation } from '../../core/decision-log';

export class InProcessMonitor {
    private context: ActionContext;
    private policy: InProcessMonitorPolicy;
    private eventBus: EnforcementEventBus;
    private cumulativeSensitiveReads: number = 0;
    private anomalyEngine: AnomalyDetectionEngine;
    private propagationModule: ViolationPropagationModule;

    constructor(context: ActionContext, policy: InProcessMonitorPolicy) {
        this.context = context;
        this.policy = policy;
        this.eventBus = EnforcementEventBus.getInstance();
        this.anomalyEngine = new AnomalyDetectionEngine(context.params['anomalyThresholds'], context.params['anomalySlowDelayMs']);
        this.propagationModule = ViolationPropagationModule.getInstance();

        // Initialize cumulative reads from existing trace if any
        if (this.context.executionTrace) {
            this.context.executionTrace.forEach(step => {
                step.dataAccess?.forEach(event => {
                    if (event.sensitivity === 'high' || event.sensitivity === 'medium') {
                        this.cumulativeSensitiveReads += (event.recordCount || 0);
                    }
                });
            });
        } else {
            this.context.executionTrace = [];
        }
    }

    public async recordStep(step: ExecutionStep): Promise<Violation[]> {
        const violations: Violation[] = [];
        const { thresholdTightness } = this.propagationModule.getPropagationParameters();

        step.timestamp = step.timestamp || new Date();
        this.context.executionTrace!.push(step);

        // 1. Track deviation from declared intent
        if (step.observedIntent && !this.isIntentAligned(step.observedIntent, this.context.intent)) {
            violations.push(this.createViolation(
                ViolationCategory.ANOMALY,
                ViolationSeverity.MEDIUM,
                `Intent deviation detected: Observed "${step.observedIntent}" while declared intent was "${this.context.intent}"`,
                { observedIntent: step.observedIntent, declaredIntent: this.context.intent }
            ));
        }

        // 2. Authority scope drift
        if (step.authorityScopeUsed) {
            const unauthorizedScopes = step.authorityScopeUsed.filter(
                scope => !this.policy.declaredAuthorityScope.includes(scope)
            );
            if (unauthorizedScopes.length > 0) {
                violations.push(this.createViolation(
                    ViolationCategory.SCOPE,
                    ViolationSeverity.HIGH,
                    `Authority scope drift: Agent used unauthorized scopes: ${unauthorizedScopes.join(', ')}`,
                    { unauthorizedScopes }
                ));
            }
        }

        // 3. Unexpected API calls
        if (step.apiCalls) {
            const unexpectedApis = step.apiCalls.filter(
                api => !this.policy.allowedApis.includes(api)
            );
            if (unexpectedApis.length > 0) {
                violations.push(this.createViolation(
                    ViolationCategory.PERMISSION,
                    ViolationSeverity.HIGH,
                    `Unexpected API calls: Agent called unauthorized APIs: ${unexpectedApis.join(', ')}`,
                    { unexpectedApis }
                ));
            }
        }

        // 4. Anomalous data access patterns
        if (step.dataAccess) {
            // Tighten numerical thresholds if tightness is active
            const maxRecordsAdjusted = thresholdTightness > 0
                ? Math.ceil(this.policy.maxRecordsPerStep * (1.0 - (thresholdTightness * 0.5)))
                : this.policy.maxRecordsPerStep;

            const maxCumulativeAdjusted = thresholdTightness > 0
                ? Math.ceil(this.policy.maxCumulativeSensitiveReads * (1.0 - (thresholdTightness * 0.5)))
                : this.policy.maxCumulativeSensitiveReads;

            for (const access of step.dataAccess) {
                if (access.recordCount && access.recordCount > maxRecordsAdjusted) {
                    violations.push(this.createViolation(
                        ViolationCategory.ANOMALY,
                        ViolationSeverity.MEDIUM,
                        `Anomalous data access: Step exceeded ${thresholdTightness > 0 ? 'tightened ' : ''}maximum records per step (${access.recordCount} > ${maxRecordsAdjusted})`,
                        { resource: access.resource, recordCount: access.recordCount, threshold: maxRecordsAdjusted }
                    ));
                }

                if (access.sensitivity === 'high' || access.sensitivity === 'medium') {
                    this.cumulativeSensitiveReads += (access.recordCount || 0);
                }
            }

            if (this.cumulativeSensitiveReads > maxCumulativeAdjusted) {
                violations.push(this.createViolation(
                    ViolationCategory.ANOMALY,
                    ViolationSeverity.HIGH,
                    `Anomalous data access: Cumulative sensitive reads exceeded ${thresholdTightness > 0 ? 'tightened ' : ''}threshold (${this.cumulativeSensitiveReads} > ${maxCumulativeAdjusted})`,
                    { cumulativeSensitiveReads: this.cumulativeSensitiveReads, threshold: maxCumulativeAdjusted }
                ));
            }
        }

        // 5. Cooperative instability signals
        if (step.cooperativeSignals) {
            const minStabilityAdjusted = thresholdTightness > 0
                ? Math.min(0.95, this.policy.minCooperativeStability + (thresholdTightness * 0.15))
                : this.policy.minCooperativeStability;

            for (const signal of step.cooperativeSignals) {
                if (signal.stabilityScore < minStabilityAdjusted) {
                    violations.push(this.createViolation(
                        ViolationCategory.IMPACT,
                        ViolationSeverity.MEDIUM,
                        `Cooperative instability: Stability score for partner ${signal.partnerId} is too low (${signal.stabilityScore} < ${minStabilityAdjusted.toFixed(2)})`,
                        { partnerId: signal.partnerId, stabilityScore: signal.stabilityScore, threshold: minStabilityAdjusted }
                    ));
                }
                if (signal.conflictScore && signal.conflictScore > this.policy.maxCooperativeConflict) {
                    violations.push(this.createViolation(
                        ViolationCategory.IMPACT,
                        ViolationSeverity.HIGH,
                        `Cooperative instability: Conflict score for partner ${signal.partnerId} is too high (${signal.conflictScore} > ${this.policy.maxCooperativeConflict})`,
                        { partnerId: signal.partnerId, conflictScore: signal.conflictScore }
                    ));
                }
            }
        }

        // 6. Deviation from pre-execution predicted behavior vector
        const anomalyDecision = this.anomalyEngine.evaluate(this.context, step, this.policy);
        const deviationMetadata = {
            deviationScore: anomalyDecision.deviationScore,
            threshold: anomalyDecision.threshold,
            action: anomalyDecision.action,
            predictedVector: anomalyDecision.predicted,
            liveVector: anomalyDecision.live,
            stepId: step.stepId
        };

        if (anomalyDecision.action === 'WARN') {
            violations.push(this.createViolation(
                ViolationCategory.ANOMALY,
                ViolationSeverity.MEDIUM,
                `Anomaly warning: behavior deviation score ${anomalyDecision.deviationScore.toFixed(2)} exceeded warning threshold ${anomalyDecision.threshold?.toFixed(2)}.`,
                deviationMetadata
            ));
        }

        if (anomalyDecision.action === 'SLOW') {
            violations.push(this.createViolation(
                ViolationCategory.ANOMALY,
                ViolationSeverity.MEDIUM,
                `Execution throttled: deviation score ${anomalyDecision.deviationScore.toFixed(2)} exceeded slow threshold ${anomalyDecision.threshold?.toFixed(2)}.`,
                deviationMetadata
            ));
            await this.anomalyEngine.enforceDelayIfNeeded('SLOW');
        }

        if (anomalyDecision.action === 'REQUIRE_APPROVAL') {
            const approved = this.isStepAnomalyApproved(step.stepId);
            if (!approved) {
                violations.push(this.createViolation(
                    ViolationCategory.ANOMALY,
                    ViolationSeverity.HIGH,
                    `Manual approval required: deviation score ${anomalyDecision.deviationScore.toFixed(2)} exceeded approval threshold ${anomalyDecision.threshold?.toFixed(2)}.`,
                    deviationMetadata
                ));
                this.context.status = EnforcementState.SUSPENDED;
            }
        }

        if (anomalyDecision.action === 'HALT') {
            violations.push(this.createViolation(
                ViolationCategory.ANOMALY,
                ViolationSeverity.CRITICAL,
                `Execution halted: deviation score ${anomalyDecision.deviationScore.toFixed(2)} exceeded halt threshold ${anomalyDecision.threshold?.toFixed(2)}.`,
                deviationMetadata
            ));
            this.context.status = EnforcementState.SUSPENDED;
        }

        // Record violations in context and emit events
        if (violations.length > 0) {
            this.context.violations.push(...violations);
            violations.forEach(v => this.eventBus.emitViolation(this.context.actionId, v));

            // Check for critical violations to suspend execution
            if (violations.some(v => v.severity === ViolationSeverity.CRITICAL || v.severity === ViolationSeverity.HIGH)) {
                this.context.status = EnforcementState.SUSPENDED;
                appendDecisionExplanation(this.context, {
                    layer: 'IN_PROCESS',
                    component: 'InProcessMonitor',
                    outcome: 'SUSPEND',
                    summary: `Execution suspended at step ${step.stepId} due to high-severity violations.`,
                    rationale: [
                        'At least one HIGH or CRITICAL violation was detected in the current step.',
                        'Policy requires suspension for immediate containment.'
                    ],
                    evidence: {
                        stepId: step.stepId,
                        violationIds: violations.map(v => v.id),
                        severities: violations.map(v => v.severity)
                    }
                });
            }
        } else {
            appendDecisionExplanation(this.context, {
                layer: 'IN_PROCESS',
                component: 'InProcessMonitor',
                outcome: 'PASS',
                summary: `Execution step ${step.stepId} passed in-process checks.`,
                rationale: [
                    'No scope, API, data-access, cooperative, or anomaly thresholds were violated.',
                    'Execution can continue to the next step.'
                ],
                evidence: { stepId: step.stepId }
            });
        }

        this.eventBus.emitStateChange(this.context);
        return violations;
    }

    private isIntentAligned(observed: string, declared: string): boolean {
        // Simple semantic similarity proxy or keyword matching
        // In a real system, this would use an LLM-based evaluator
        const observedLower = observed.toLowerCase();
        const declaredLower = declared.toLowerCase();

        const declaredKeywords = declaredLower.split(' ').filter(word => word.length > 3);
        const matchCount = declaredKeywords.filter(word => observedLower.includes(word)).length;

        return matchCount > 0 || observedLower.includes(declaredLower) || declaredLower.includes(observedLower);
    }

    private createViolation(
        category: ViolationCategory,
        severity: ViolationSeverity,
        description: string,
        metadata: any
    ): Violation {
        const violation = {
            id: `v-inproc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date(),
            category,
            severity,
            description,
            sourceLayer: 'InProcessMonitor',
            metadata
        };

        appendDecisionExplanation(this.context, {
            layer: 'IN_PROCESS',
            component: 'InProcessMonitor',
            outcome: severity === ViolationSeverity.HIGH || severity === ViolationSeverity.CRITICAL ? 'SUSPEND' : 'WARN',
            summary: description,
            rationale: [
                `Violation category ${category} triggered during live execution.`,
                `Severity ${severity} requires ${severity === ViolationSeverity.HIGH || severity === ViolationSeverity.CRITICAL ? 'containment-oriented handling.' : 'continued execution with monitoring.'}`
            ],
            evidence: metadata || {}
        });

        return violation;
    }

    public getContext(): ActionContext {
        return this.context;
    }

    private isStepAnomalyApproved(stepId: string): boolean {
        if (this.context.anomalyApprovalGranted === true) {
            return true;
        }

        const approvedSteps = this.context.params['anomalyApprovedSteps'];
        if (approvedSteps === '*') {
            return true;
        }

        return Array.isArray(approvedSteps) && approvedSteps.includes(stepId);
    }
}

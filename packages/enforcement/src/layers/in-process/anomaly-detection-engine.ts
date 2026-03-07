import {
    ActionContext,
    AnomalyMitigationAction,
    AnomalyToleranceThresholds,
    BehaviorVector,
    ExecutionStep,
    InProcessMonitorPolicy
} from '../../core/models';
import { ViolationPropagationModule } from '../../core/violation-propagation';
import { ThresholdAdaptationEngine } from '../../core/threshold-adaptation-engine';

export interface AnomalyDetectionDecision {
    deviationScore: number;
    action: AnomalyMitigationAction;
    predicted: BehaviorVector;
    live: BehaviorVector;
    threshold: number | null;
}

export class AnomalyDetectionEngine {
    private readonly thresholds: AnomalyToleranceThresholds;
    private readonly actionDelayMs: number;
    private propagationModule: ViolationPropagationModule;
    private adaptationEngine: ThresholdAdaptationEngine;

    constructor(thresholds?: Partial<AnomalyToleranceThresholds>, actionDelayMs: number = 250) {
        this.thresholds = {
            warn: thresholds?.warn ?? 0.25,
            slow: thresholds?.slow ?? 0.4,
            requireApproval: thresholds?.requireApproval ?? 0.6,
            halt: thresholds?.halt ?? 0.8
        };
        this.actionDelayMs = actionDelayMs;
        this.propagationModule = ViolationPropagationModule.getInstance();
        this.adaptationEngine = ThresholdAdaptationEngine.getInstance();
    }

    public async enforceDelayIfNeeded(action: AnomalyMitigationAction): Promise<void> {
        if (action !== 'SLOW') {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, this.actionDelayMs));
    }

    public evaluate(
        context: ActionContext,
        step: ExecutionStep,
        policy: InProcessMonitorPolicy
    ): AnomalyDetectionDecision {
        const predicted = context.predictedBehaviorVector || this.defaultPredictedVector();
        const live = this.deriveLiveBehaviorVector(context, step, policy);
        const deviationScore = this.computeDeviationScore(predicted, live);
        const { action, threshold } = this.resolveAction(deviationScore);

        return {
            deviationScore,
            action,
            predicted,
            live,
            threshold
        };
    }

    private resolveAction(score: number): { action: AnomalyMitigationAction, threshold: number | null } {
        const { thresholdTightness } = this.propagationModule.getPropagationParameters();
        const { anomalySensitivity, precisionWeight } = this.adaptationEngine.getCurrentProfile();

        // Higher precisionWeight (e.g. 0.8) favors autonomy (higher thresholds = less likely to flag)
        const weightFactor = 1.0 + (precisionWeight - 0.5) * 0.4;

        // Apply tightness: higher tightness reduces the effective threshold
        // Apply sensitivity: higher sensitivity reduces the effective threshold
        const adjust = (t: number) => {
            // Sensitivity 2.0 makes 0.8 -> 0.4. Sensitivity 0.5 makes 0.8 -> 1.0 (clamped)
            const sensBase = (t * weightFactor) / anomalySensitivity;
            return Math.max(0.05, Math.min(0.95, sensBase * (1.0 - (thresholdTightness * 0.7))));
        };

        const tHalt = adjust(this.thresholds.halt);
        const tApproval = adjust(this.thresholds.requireApproval);
        const tSlow = adjust(this.thresholds.slow);
        const tWarn = adjust(this.thresholds.warn);

        if (thresholdTightness > 0 || anomalySensitivity !== 1.0 || precisionWeight !== 0.5) {
            console.log(`[AnomalyDetectionEngine] Adjustments (Tightness: ${thresholdTightness.toFixed(2)}, Sensitivity: ${anomalySensitivity.toFixed(2)}, Weight: ${precisionWeight.toFixed(2)}). HALT threshold: ${tHalt.toFixed(2)}`);
        }

        if (score >= tHalt) {
            return { action: 'HALT', threshold: tHalt };
        }
        if (score >= tApproval) {
            return { action: 'REQUIRE_APPROVAL', threshold: tApproval };
        }
        if (score >= tSlow) {
            return { action: 'SLOW', threshold: tSlow };
        }
        if (score >= tWarn) {
            return { action: 'WARN', threshold: tWarn };
        }
        return { action: 'NONE', threshold: null };
    }

    private computeDeviationScore(predicted: BehaviorVector, live: BehaviorVector): number {
        const deltas = [
            Math.abs(predicted.intentDeviationRisk - live.intentDeviationRisk),
            Math.abs(predicted.scopeDriftRisk - live.scopeDriftRisk),
            Math.abs(predicted.apiNoveltyRisk - live.apiNoveltyRisk),
            Math.abs(predicted.sensitiveDataExposureRisk - live.sensitiveDataExposureRisk),
            Math.abs(predicted.cooperativeInstabilityRisk - live.cooperativeInstabilityRisk),
            Math.abs(predicted.dataVolumeRisk - live.dataVolumeRisk)
        ];

        const meanDelta = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
        return Math.max(0, Math.min(1, meanDelta));
    }

    private deriveLiveBehaviorVector(
        context: ActionContext,
        step: ExecutionStep,
        policy: InProcessMonitorPolicy
    ): BehaviorVector {
        const normalize = (value: number) => Math.max(0, Math.min(1, value));
        const highImpactIntentWords = ['delete', 'drop', 'exfiltrate', 'disable', 'override', 'shutdown'];
        const observedIntent = (step.observedIntent || '').toLowerCase();
        const declaredIntent = context.intent.toLowerCase();

        const intentDeviationRisk =
            !observedIntent
                ? 0
                : this.intentSimilarity(observedIntent, declaredIntent) >= 0.25
                    ? 0
                    : highImpactIntentWords.some(word => observedIntent.includes(word)) ? 1 : 0.65;

        const usedScopes = step.authorityScopeUsed || [];
        const unauthorizedScopes = usedScopes.filter(scope => !policy.declaredAuthorityScope.includes(scope));
        const scopeDriftRisk = usedScopes.length === 0 ? 0 : normalize(unauthorizedScopes.length / usedScopes.length);

        const usedApis = step.apiCalls || [];
        const unexpectedApis = usedApis.filter(api => !policy.allowedApis.includes(api));
        const apiNoveltyRisk = usedApis.length === 0 ? 0 : normalize(unexpectedApis.length / usedApis.length);

        const stepReads = (step.dataAccess || [])
            .filter(access => access.operation === 'read')
            .reduce((sum, access) => sum + (access.recordCount || 0), 0);
        const stepSensitiveReads = (step.dataAccess || [])
            .filter(access => access.operation === 'read' && (access.sensitivity === 'medium' || access.sensitivity === 'high'))
            .reduce((sum, access) => sum + (access.recordCount || 0), 0);

        const sensitiveDataExposureRisk = stepReads === 0 ? 0 : normalize(stepSensitiveReads / stepReads);
        const dataVolumeRisk = normalize(stepReads / Math.max(1, policy.maxRecordsPerStep));

        let cooperativeInstabilityRisk = 0;
        if (step.cooperativeSignals && step.cooperativeSignals.length > 0) {
            const instabilityValues = step.cooperativeSignals.map(signal => {
                const stabilityDeficit = signal.stabilityScore < policy.minCooperativeStability
                    ? (policy.minCooperativeStability - signal.stabilityScore)
                    : 0;
                const conflictExcess = signal.conflictScore && signal.conflictScore > policy.maxCooperativeConflict
                    ? (signal.conflictScore - policy.maxCooperativeConflict)
                    : 0;
                return normalize(stabilityDeficit + conflictExcess);
            });

            cooperativeInstabilityRisk = normalize(
                instabilityValues.reduce((sum, value) => sum + value, 0) / instabilityValues.length
            );
        }

        return {
            intentDeviationRisk: normalize(intentDeviationRisk),
            scopeDriftRisk,
            apiNoveltyRisk,
            sensitiveDataExposureRisk,
            cooperativeInstabilityRisk,
            dataVolumeRisk
        };
    }

    private intentSimilarity(observed: string, declared: string): number {
        const observedTokens = new Set(observed.split(/\s+/).filter(token => token.length > 3));
        const declaredTokens = new Set(declared.split(/\s+/).filter(token => token.length > 3));

        if (observedTokens.size === 0 || declaredTokens.size === 0) {
            return 0;
        }

        let overlap = 0;
        observedTokens.forEach(token => {
            if (declaredTokens.has(token)) {
                overlap += 1;
            }
        });

        return overlap / declaredTokens.size;
    }

    private defaultPredictedVector(): BehaviorVector {
        return {
            intentDeviationRisk: 0.15,
            scopeDriftRisk: 0.15,
            apiNoveltyRisk: 0.15,
            sensitiveDataExposureRisk: 0.2,
            cooperativeInstabilityRisk: 0.15,
            dataVolumeRisk: 0.25
        };
    }
}

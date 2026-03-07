import type { RiskScoreResult } from './RiskScoringEngine.js';

export type ClassificationState = 'auto-approve' | 'flag-for-review' | 'block';

export interface ThresholdBand {
    autoApproveMin: number;
    blockMax: number;
}

export interface ViolationTrendSnapshot {
    violationRate: number;
    momentum: number;
    severityAdjustedRate: number;
}

export interface ClassificationContext {
    /**
     * 0.0 to 1.0. Higher means more conservative system posture.
     */
    riskPosture: number;
    /**
     * Optional entropy override (0.0 to 1.0). If omitted, calculated from score breakdown.
     */
    entropyLevel?: number;
    /**
     * Optional violation trend override. If omitted, history-based trend is used.
     */
    recentViolationTrend?: ViolationTrendSnapshot;
    /**
     * Preemptive risk lift produced by historical recurrence detection (0.0 to 1.0).
     * Used to escalate classification before concrete harm occurs.
     */
    preemptiveRiskLift?: number;
    /**
     * Optional threshold where preemptive lift upgrades auto-approve to review.
     */
    preemptiveEscalationThreshold?: number;
    /**
     * Optional threshold where preemptive lift upgrades any state to block.
     */
    preemptiveBlockThreshold?: number;
}

export interface ClassificationResult {
    state: ClassificationState;
    thresholdBand: ThresholdBand;
    normalizedSignals: {
        riskPosture: number;
        entropyLevel: number;
        violationTrend: number;
    };
    shiftMagnitude: number;
    rationale: string[];
}

export interface DecisionOutcomeFeedback {
    violated: boolean;
    /**
     * 0.0 to 1.0. Higher values represent more severe violations.
     */
    severity?: number;
}

interface ViolationEvent {
    violated: boolean;
    severity: number;
}

/**
 * ClassificationEngine maps a decision score into one of three states using adaptive threshold bands.
 * Thresholds shift continuously based on risk posture, entropy, and recent violation trends.
 */
export class ClassificationEngine {
    private readonly baseThresholds: ThresholdBand = {
        autoApproveMin: 72,
        blockMax: 42,
    };

    private readonly minReviewGap = 12;
    private readonly maxShift = 18;
    private readonly historyWindowSize: number;
    private violationHistory: ViolationEvent[] = [];

    constructor(historyWindowSize: number = 50) {
        this.historyWindowSize = Math.max(10, historyWindowSize);
    }

    public classify(
        scoreResult: RiskScoreResult,
        context: ClassificationContext
    ): ClassificationResult {
        const riskPosture = this.clamp01(context.riskPosture);
        const entropyLevel = context.entropyLevel !== undefined
            ? this.clamp01(context.entropyLevel)
            : this.estimateEntropy(scoreResult);
        const violationSnapshot = context.recentViolationTrend ?? this.computeViolationTrendSnapshot();
        const violationTrendSignal = this.clamp01(
            (violationSnapshot.severityAdjustedRate * 0.7) +
            (violationSnapshot.momentum * 0.3)
        );

        // Combined conservatism signal, centered at 0.5.
        // >0.5 tightens approvals + broadens block band; <0.5 relaxes thresholds.
        const conservatismSignal = this.clamp01(
            (riskPosture * 0.45) +
            (entropyLevel * 0.25) +
            (violationTrendSignal * 0.3)
        );
        const normalizedShift = (conservatismSignal - 0.5) * 2; // -1..1
        const shiftMagnitude = normalizedShift * this.maxShift;

        let autoApproveMin = this.baseThresholds.autoApproveMin + shiftMagnitude;
        let blockMax = this.baseThresholds.blockMax + shiftMagnitude;

        // Increase review width when entropy spikes.
        const entropyBandExpansion = (entropyLevel - 0.5) * 8;
        autoApproveMin += entropyBandExpansion;
        blockMax += entropyBandExpansion;

        const thresholdBand = this.normalizeThresholdBand({
            autoApproveMin,
            blockMax,
        });

        const preemptiveRiskLift = this.clamp01(context.preemptiveRiskLift ?? 0);
        const preemptiveEscalationThreshold = this.clamp01(context.preemptiveEscalationThreshold ?? 0.14);
        const preemptiveBlockThreshold = this.clamp01(context.preemptiveBlockThreshold ?? 0.3);
        const baseState = this.resolveState(scoreResult.decisionScore, thresholdBand);
        const state = this.applyPreemptiveEscalation(
            baseState,
            preemptiveRiskLift,
            preemptiveEscalationThreshold,
            preemptiveBlockThreshold
        );

        const rationale = [
            `Risk posture contributed ${riskPosture.toFixed(2)} to conservatism`,
            `Entropy level ${entropyLevel.toFixed(2)} adjusted review-band width`,
            `Violation trend signal ${violationTrendSignal.toFixed(2)} shifted both thresholds`,
            `Final adaptive thresholds: block <= ${thresholdBand.blockMax.toFixed(2)}, auto-approve >= ${thresholdBand.autoApproveMin.toFixed(2)}`
        ];
        if (state !== baseState) {
            rationale.push(
                `Preemptive detection escalated state from ${baseState} to ${state} (lift=${preemptiveRiskLift.toFixed(2)})`
            );
        }

        return {
            state,
            thresholdBand: {
                blockMax: Number(thresholdBand.blockMax.toFixed(2)),
                autoApproveMin: Number(thresholdBand.autoApproveMin.toFixed(2))
            },
            normalizedSignals: {
                riskPosture: Number(riskPosture.toFixed(4)),
                entropyLevel: Number(entropyLevel.toFixed(4)),
                violationTrend: Number(violationTrendSignal.toFixed(4)),
            },
            shiftMagnitude: Number(shiftMagnitude.toFixed(4)),
            rationale
        };
    }

    public recordOutcome(feedback: DecisionOutcomeFeedback): void {
        const event: ViolationEvent = {
            violated: feedback.violated,
            severity: this.clamp01(feedback.severity ?? (feedback.violated ? 0.6 : 0)),
        };
        this.violationHistory.push(event);

        if (this.violationHistory.length > this.historyWindowSize) {
            this.violationHistory = this.violationHistory.slice(-this.historyWindowSize);
        }
    }

    public getViolationTrendSnapshot(): ViolationTrendSnapshot {
        return this.computeViolationTrendSnapshot();
    }

    private resolveState(decisionScore: number, thresholdBand: ThresholdBand): ClassificationState {
        if (decisionScore >= thresholdBand.autoApproveMin) {
            return 'auto-approve';
        }
        if (decisionScore <= thresholdBand.blockMax) {
            return 'block';
        }
        return 'flag-for-review';
    }

    private applyPreemptiveEscalation(
        baseState: ClassificationState,
        preemptiveRiskLift: number,
        escalationThreshold: number,
        blockThreshold: number
    ): ClassificationState {
        if (preemptiveRiskLift >= blockThreshold) {
            return 'block';
        }

        if (preemptiveRiskLift >= escalationThreshold && baseState === 'auto-approve') {
            return 'flag-for-review';
        }

        return baseState;
    }

    private normalizeThresholdBand(band: ThresholdBand): ThresholdBand {
        let autoApproveMin = this.clamp(band.autoApproveMin, 50, 95);
        let blockMax = this.clamp(band.blockMax, 5, 70);

        // Ensure there is always a meaningful review interval.
        if (autoApproveMin - blockMax < this.minReviewGap) {
            const center = (autoApproveMin + blockMax) / 2;
            autoApproveMin = this.clamp(center + (this.minReviewGap / 2), 50, 95);
            blockMax = this.clamp(center - (this.minReviewGap / 2), 5, 70);
        }

        return { autoApproveMin, blockMax };
    }

    private estimateEntropy(scoreResult: RiskScoreResult): number {
        const values = Object.values(scoreResult.breakdown.dimensionScores).map((v) => this.clamp01(v));
        const sum = values.reduce((acc, value) => acc + value, 0);
        if (sum <= 0) {
            return 0;
        }

        const probabilities = values.map((value) => value / sum);
        const entropy = -probabilities.reduce((acc, p) => {
            if (p <= 0) return acc;
            return acc + (p * Math.log2(p));
        }, 0);
        const maxEntropy = Math.log2(probabilities.length);

        return this.clamp01(maxEntropy > 0 ? entropy / maxEntropy : 0);
    }

    private computeViolationTrendSnapshot(): ViolationTrendSnapshot {
        if (this.violationHistory.length === 0) {
            return {
                violationRate: 0,
                momentum: 0,
                severityAdjustedRate: 0,
            };
        }

        const total = this.violationHistory.length;
        const split = Math.max(1, Math.floor(total / 2));
        const older = this.violationHistory.slice(0, split);
        const recent = this.violationHistory.slice(split);

        const olderRate = this.computeViolationRate(older);
        const recentRate = this.computeViolationRate(recent);
        const momentum = this.clamp01((recentRate - olderRate + 1) / 2);

        const severityAdjustedRate = this.clamp01(
            this.violationHistory.reduce((acc, event) => {
                if (!event.violated) return acc;
                return acc + Math.max(0.1, event.severity);
            }, 0) / total
        );

        return {
            violationRate: Number(recentRate.toFixed(4)),
            momentum: Number(momentum.toFixed(4)),
            severityAdjustedRate: Number(severityAdjustedRate.toFixed(4)),
        };
    }

    private computeViolationRate(events: ViolationEvent[]): number {
        if (events.length === 0) {
            return 0;
        }
        const violations = events.reduce((acc, event) => acc + (event.violated ? 1 : 0), 0);
        return this.clamp01(violations / events.length);
    }

    private clamp01(value: number): number {
        return this.clamp(value, 0, 1);
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }
}

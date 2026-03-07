import type { DecisionObject } from './DecisionObject.js';
import type { ClassificationState } from './ClassificationEngine.js';

export interface DownstreamOutcomeRecord {
    decisionId: string;
    actionType: string;
    metadata: {
        agentType?: string;
        contextId?: string;
    };
    authorityScope: {
        layer: string;
        permissions: string[];
    };
    policyExposure?: {
        policyId: string;
        exposureLevel: number;
        potentialViolations: string[];
    }[];
    complianceFailure: boolean;
    downstreamFailure: boolean;
    severity: number; // 0.0 to 1.0
    timestamp: Date;
}

export interface PreemptivePatternSnapshot {
    signature: string;
    sampleSize: number;
    failureRate: number;
    weightedSeverity: number;
    preemptiveRiskLift: number;
}

export interface PreemptiveRiskAssessment {
    riskLift: number; // 0.0 to 1.0
    matchedPatternSignatures: string[];
    rationale: string[];
}

export interface PreemptiveClassificationRecommendation {
    recommendedState: ClassificationState | null;
    escalationReason: string;
}

export interface PreemptiveDetectionLayerOptions {
    maxHistorySize?: number;
    minSamplesForActivation?: number;
    minFailureRateForActivation?: number;
    maxRiskLift?: number;
    reviewEscalationLiftThreshold?: number;
    blockEscalationLiftThreshold?: number;
}

interface PatternAggregate {
    signature: string;
    sampleSize: number;
    weightedFailureEvents: number;
    weightedSeverityTotal: number;
    preemptiveRiskLift: number;
}

/**
 * Learns recurring patterns tied to downstream failures or compliance issues
 * and proactively raises risk for future similar actions.
 */
export class PreemptiveDetectionLayer {
    private readonly maxHistorySize: number;
    private readonly minSamplesForActivation: number;
    private readonly minFailureRateForActivation: number;
    private readonly maxRiskLift: number;
    private readonly reviewEscalationLiftThreshold: number;
    private readonly blockEscalationLiftThreshold: number;
    private history: DownstreamOutcomeRecord[] = [];
    private patternMap: Map<string, PatternAggregate> = new Map();

    constructor(options: PreemptiveDetectionLayerOptions = {}) {
        this.maxHistorySize = options.maxHistorySize ?? 500;
        this.minSamplesForActivation = options.minSamplesForActivation ?? 3;
        this.minFailureRateForActivation = options.minFailureRateForActivation ?? 0.45;
        this.maxRiskLift = options.maxRiskLift ?? 0.35;
        this.reviewEscalationLiftThreshold = options.reviewEscalationLiftThreshold ?? 0.14;
        this.blockEscalationLiftThreshold = options.blockEscalationLiftThreshold ?? 0.3;
    }

    public recordOutcome(record: DownstreamOutcomeRecord): void {
        const normalized: DownstreamOutcomeRecord = {
            ...record,
            severity: this.clamp01(record.severity),
            timestamp: record.timestamp ?? new Date(),
        };

        this.history.push(normalized);
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(-this.maxHistorySize);
        }

        this.recomputePatterns();
    }

    public recordDecisionOutcome(
        decision: DecisionObject,
        outcome: {
            complianceFailure: boolean;
            downstreamFailure: boolean;
            severity: number;
            timestamp?: Date;
        }
    ): void {
        this.recordOutcome({
            decisionId: decision.id,
            actionType: decision.actionType,
            metadata: decision.metadata,
            authorityScope: decision.authorityScope,
            policyExposure: decision.policyExposure,
            complianceFailure: outcome.complianceFailure,
            downstreamFailure: outcome.downstreamFailure,
            severity: outcome.severity,
            timestamp: outcome.timestamp ?? new Date(),
        });
    }

    public assess(decision: DecisionObject): PreemptiveRiskAssessment {
        const candidateSignatures = this.getSignaturesForDecision(decision);
        const matched: PatternAggregate[] = [];

        for (const signature of candidateSignatures) {
            const aggregate = this.patternMap.get(signature);
            if (aggregate) {
                matched.push(aggregate);
            }
        }

        if (matched.length === 0) {
            return {
                riskLift: 0,
                matchedPatternSignatures: [],
                rationale: ['No activated historical risk pattern matched this decision'],
            };
        }

        const strongest = matched.reduce((a, b) =>
            a.preemptiveRiskLift >= b.preemptiveRiskLift ? a : b
        );

        const rationale = matched
            .sort((a, b) => b.preemptiveRiskLift - a.preemptiveRiskLift)
            .slice(0, 3)
            .map((m) => {
                const failureRate = m.sampleSize > 0 ? m.weightedFailureEvents / m.sampleSize : 0;
                const weightedSeverity = m.weightedFailureEvents > 0
                    ? m.weightedSeverityTotal / m.weightedFailureEvents
                    : 0;
                return `Pattern ${m.signature} recurring failures: rate=${failureRate.toFixed(2)}, severity=${weightedSeverity.toFixed(2)}, samples=${m.sampleSize}`;
            });

        return {
            riskLift: Number(this.clamp(strongest.preemptiveRiskLift, 0, this.maxRiskLift).toFixed(4)),
            matchedPatternSignatures: matched.map((m) => m.signature),
            rationale,
        };
    }

    public getPatternSnapshots(): PreemptivePatternSnapshot[] {
        return Array.from(this.patternMap.values())
            .map((pattern) => {
                const failureRate = pattern.sampleSize > 0
                    ? pattern.weightedFailureEvents / pattern.sampleSize
                    : 0;
                const weightedSeverity = pattern.weightedFailureEvents > 0
                    ? pattern.weightedSeverityTotal / pattern.weightedFailureEvents
                    : 0;
                return {
                    signature: pattern.signature,
                    sampleSize: pattern.sampleSize,
                    failureRate: Number(this.clamp01(failureRate).toFixed(4)),
                    weightedSeverity: Number(this.clamp01(weightedSeverity).toFixed(4)),
                    preemptiveRiskLift: Number(this.clamp(pattern.preemptiveRiskLift, 0, this.maxRiskLift).toFixed(4)),
                };
            })
            .sort((a, b) => b.preemptiveRiskLift - a.preemptiveRiskLift);
    }

    public recommendClassificationEscalation(
        assessment: PreemptiveRiskAssessment
    ): PreemptiveClassificationRecommendation {
        if (assessment.riskLift >= this.blockEscalationLiftThreshold) {
            return {
                recommendedState: 'block',
                escalationReason: `Recurring high-failure pattern exceeds block threshold (${assessment.riskLift.toFixed(2)})`,
            };
        }

        if (assessment.riskLift >= this.reviewEscalationLiftThreshold) {
            return {
                recommendedState: 'flag-for-review',
                escalationReason: `Recurring risk pattern exceeds review threshold (${assessment.riskLift.toFixed(2)})`,
            };
        }

        return {
            recommendedState: null,
            escalationReason: 'No preemptive escalation required',
        };
    }

    private recomputePatterns(): void {
        const nextMap: Map<string, PatternAggregate> = new Map();

        for (const event of this.history) {
            const signatures = this.getSignaturesForRecord(event);
            const failureSignal =
                (event.complianceFailure ? 0.65 : 0) +
                (event.downstreamFailure ? 0.35 : 0);
            const weightedFailure = this.clamp01(failureSignal);

            for (const signature of signatures) {
                const existing = nextMap.get(signature) ?? {
                    signature,
                    sampleSize: 0,
                    weightedFailureEvents: 0,
                    weightedSeverityTotal: 0,
                    preemptiveRiskLift: 0,
                };

                existing.sampleSize += 1;
                existing.weightedFailureEvents += weightedFailure;
                existing.weightedSeverityTotal += weightedFailure * event.severity;

                nextMap.set(signature, existing);
            }
        }

        for (const pattern of nextMap.values()) {
            const failureRate = pattern.sampleSize > 0
                ? pattern.weightedFailureEvents / pattern.sampleSize
                : 0;
            const weightedSeverity = pattern.weightedFailureEvents > 0
                ? pattern.weightedSeverityTotal / pattern.weightedFailureEvents
                : 0;

            pattern.preemptiveRiskLift = this.computeRiskLift(
                pattern.sampleSize,
                failureRate,
                weightedSeverity
            );
        }

        this.patternMap = nextMap;
    }

    private computeRiskLift(sampleSize: number, failureRate: number, weightedSeverity: number): number {
        if (sampleSize < this.minSamplesForActivation) {
            return 0;
        }
        if (failureRate < this.minFailureRateForActivation) {
            return 0;
        }

        const sampleConfidence = this.clamp01(sampleSize / (this.minSamplesForActivation + 4));
        const base = this.clamp01(
            (failureRate * 0.65) +
            (weightedSeverity * 0.25) +
            (sampleConfidence * 0.1)
        );

        return this.clamp(base * this.maxRiskLift, 0, this.maxRiskLift);
    }

    private getSignaturesForDecision(decision: DecisionObject): string[] {
        const actionType = decision.actionType.toUpperCase();
        const layer = decision.authorityScope.layer.toUpperCase();
        const agentType = (decision.metadata.agentType || 'UNKNOWN').toUpperCase();
        const permissions = this.normalizePermissions(decision.authorityScope.permissions);
        const exposureBand = this.getExposureBand(decision.policyExposure);

        return [
            `ACTION:${actionType}`,
            `ACTION:${actionType}|LAYER:${layer}`,
            `ACTION:${actionType}|AGENT:${agentType}`,
            `ACTION:${actionType}|PERMS:${permissions}`,
            `ACTION:${actionType}|LAYER:${layer}|AGENT:${agentType}`,
            `ACTION:${actionType}|EXPOSURE:${exposureBand}`,
        ];
    }

    private getSignaturesForRecord(record: DownstreamOutcomeRecord): string[] {
        const actionType = record.actionType.toUpperCase();
        const layer = record.authorityScope.layer.toUpperCase();
        const agentType = (record.metadata.agentType || 'UNKNOWN').toUpperCase();
        const permissions = this.normalizePermissions(record.authorityScope.permissions);
        const exposureBand = this.getExposureBand(record.policyExposure ?? []);

        return [
            `ACTION:${actionType}`,
            `ACTION:${actionType}|LAYER:${layer}`,
            `ACTION:${actionType}|AGENT:${agentType}`,
            `ACTION:${actionType}|PERMS:${permissions}`,
            `ACTION:${actionType}|LAYER:${layer}|AGENT:${agentType}`,
            `ACTION:${actionType}|EXPOSURE:${exposureBand}`,
        ];
    }

    private getExposureBand(
        policyExposure: Array<{ exposureLevel: number }>
    ): 'LOW' | 'MEDIUM' | 'HIGH' {
        if (policyExposure.length === 0) {
            return 'LOW';
        }

        const averageExposure =
            policyExposure.reduce((sum, exposure) => sum + this.clamp01(exposure.exposureLevel), 0) /
            policyExposure.length;
        if (averageExposure >= 0.66) {
            return 'HIGH';
        }
        if (averageExposure >= 0.33) {
            return 'MEDIUM';
        }
        return 'LOW';
    }

    private normalizePermissions(permissions: string[]): string {
        return permissions
            .map((p) => p.toUpperCase())
            .sort()
            .join(',');
    }

    private clamp01(value: number): number {
        return this.clamp(value, 0, 1);
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }
}

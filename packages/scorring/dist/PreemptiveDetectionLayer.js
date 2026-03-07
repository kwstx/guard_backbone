/**
 * Learns recurring patterns tied to downstream failures or compliance issues
 * and proactively raises risk for future similar actions.
 */
export class PreemptiveDetectionLayer {
    maxHistorySize;
    minSamplesForActivation;
    minFailureRateForActivation;
    maxRiskLift;
    reviewEscalationLiftThreshold;
    blockEscalationLiftThreshold;
    history = [];
    patternMap = new Map();
    constructor(options = {}) {
        this.maxHistorySize = options.maxHistorySize ?? 500;
        this.minSamplesForActivation = options.minSamplesForActivation ?? 3;
        this.minFailureRateForActivation = options.minFailureRateForActivation ?? 0.45;
        this.maxRiskLift = options.maxRiskLift ?? 0.35;
        this.reviewEscalationLiftThreshold = options.reviewEscalationLiftThreshold ?? 0.14;
        this.blockEscalationLiftThreshold = options.blockEscalationLiftThreshold ?? 0.3;
    }
    recordOutcome(record) {
        const normalized = {
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
    recordDecisionOutcome(decision, outcome) {
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
    assess(decision) {
        const candidateSignatures = this.getSignaturesForDecision(decision);
        const matched = [];
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
        const strongest = matched.reduce((a, b) => a.preemptiveRiskLift >= b.preemptiveRiskLift ? a : b);
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
    getPatternSnapshots() {
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
    recommendClassificationEscalation(assessment) {
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
    recomputePatterns() {
        const nextMap = new Map();
        for (const event of this.history) {
            const signatures = this.getSignaturesForRecord(event);
            const failureSignal = (event.complianceFailure ? 0.65 : 0) +
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
            pattern.preemptiveRiskLift = this.computeRiskLift(pattern.sampleSize, failureRate, weightedSeverity);
        }
        this.patternMap = nextMap;
    }
    computeRiskLift(sampleSize, failureRate, weightedSeverity) {
        if (sampleSize < this.minSamplesForActivation) {
            return 0;
        }
        if (failureRate < this.minFailureRateForActivation) {
            return 0;
        }
        const sampleConfidence = this.clamp01(sampleSize / (this.minSamplesForActivation + 4));
        const base = this.clamp01((failureRate * 0.65) +
            (weightedSeverity * 0.25) +
            (sampleConfidence * 0.1));
        return this.clamp(base * this.maxRiskLift, 0, this.maxRiskLift);
    }
    getSignaturesForDecision(decision) {
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
    getSignaturesForRecord(record) {
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
    getExposureBand(policyExposure) {
        if (policyExposure.length === 0) {
            return 'LOW';
        }
        const averageExposure = policyExposure.reduce((sum, exposure) => sum + this.clamp01(exposure.exposureLevel), 0) /
            policyExposure.length;
        if (averageExposure >= 0.66) {
            return 'HIGH';
        }
        if (averageExposure >= 0.33) {
            return 'MEDIUM';
        }
        return 'LOW';
    }
    normalizePermissions(permissions) {
        return permissions
            .map((p) => p.toUpperCase())
            .sort()
            .join(',');
    }
    clamp01(value) {
        return this.clamp(value, 0, 1);
    }
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}

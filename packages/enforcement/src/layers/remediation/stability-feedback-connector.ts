import {
    ActionContext,
    CooperativeIntelligenceMetrics,
    StabilityFeedbackReport,
    SynergyDensityForecast,
    TaskFormationProbabilityMap,
    TrustCalibrationCurve,
    Violation,
    ViolationSeverity
} from '../../core/models';

interface AgentStabilityHistory {
    totalViolations: number;
    repeatedViolationCount: number;
    cumulativeSeverity: number;
    influenceWeight: number;
    taskFormationProbabilities: TaskFormationProbabilityMap;
    actionCount: number;
}

export class StabilityFeedbackConnector {
    private readonly historyByAgent = new Map<string, AgentStabilityHistory>();

    public apply(context: ActionContext, confirmedViolations: Violation[]): StabilityFeedbackReport {
        const history = this.getOrCreateHistory(context.agentId);
        const violationSeverityLoad = confirmedViolations.reduce(
            (sum, violation) => sum + this.severityWeight(violation.severity),
            0
        );

        const repeatedViolationCount = Math.max(
            0,
            history.totalViolations > 0 ? confirmedViolations.length : 0
        );
        const repeatedPenalty = repeatedViolationCount * 0.06;
        const severityPenalty = Math.min(0.45, violationSeverityLoad * 0.15);
        const totalPenalty = Math.min(0.75, repeatedPenalty + severityPenalty);

        const influenceWeightPrevious = context.influenceWeight ?? history.influenceWeight;
        const influenceWeightUpdated = this.clamp(
            influenceWeightPrevious * (1 - totalPenalty),
            0.05,
            1
        );

        const taskFormationProbabilitiesBefore = this.normalizeProbabilities(
            context.taskFormationProbabilities || history.taskFormationProbabilities
        );
        const taskFormationProbabilitiesAfter = this.rebalanceTaskFormation(
            taskFormationProbabilitiesBefore,
            totalPenalty
        );

        const cooperativeMetrics = this.buildCooperativeMetrics(
            context,
            violationSeverityLoad,
            repeatedViolationCount,
            influenceWeightUpdated
        );
        const trustCalibrationCurve = this.buildTrustCalibrationCurve(
            context.trustCoefficient ?? 1,
            totalPenalty,
            repeatedViolationCount
        );
        const synergyDensityForecasts = this.buildSynergyForecasts(
            cooperativeMetrics,
            repeatedViolationCount
        );

        history.totalViolations += confirmedViolations.length;
        history.repeatedViolationCount += repeatedViolationCount;
        history.cumulativeSeverity += violationSeverityLoad;
        history.influenceWeight = influenceWeightUpdated;
        history.taskFormationProbabilities = taskFormationProbabilitiesAfter;
        history.actionCount += 1;

        context.influenceWeight = influenceWeightUpdated;
        context.taskFormationProbabilities = taskFormationProbabilitiesAfter;
        context.cooperativeMetrics = cooperativeMetrics;
        context.trustCalibrationCurve = trustCalibrationCurve;
        context.synergyDensityForecasts = synergyDensityForecasts;

        return {
            generatedAt: new Date(),
            influenceWeightPrevious,
            influenceWeightUpdated,
            cooperativeMetrics,
            trustCalibrationCurve,
            synergyDensityForecasts,
            taskFormationProbabilitiesBefore,
            taskFormationProbabilitiesAfter,
            repeatedViolationCount
        };
    }

    private getOrCreateHistory(agentId: string): AgentStabilityHistory {
        const existing = this.historyByAgent.get(agentId);
        if (existing) {
            return existing;
        }

        const created: AgentStabilityHistory = {
            totalViolations: 0,
            repeatedViolationCount: 0,
            cumulativeSeverity: 0,
            influenceWeight: 1,
            taskFormationProbabilities: {
                autonomous: 0.5,
                cooperative: 0.35,
                supervised: 0.15
            },
            actionCount: 0
        };

        this.historyByAgent.set(agentId, created);
        return created;
    }

    private buildCooperativeMetrics(
        context: ActionContext,
        violationSeverityLoad: number,
        repeatedViolationCount: number,
        influenceWeight: number
    ): CooperativeIntelligenceMetrics {
        const maxSeverityLoad = Math.max(1, (context.violations.length || 1) * 1.5);
        const normalizedPressure = this.clamp(violationSeverityLoad / maxSeverityLoad, 0, 1);
        const stabilityAlignment = this.clamp(
            1 - normalizedPressure * 0.65 - repeatedViolationCount * 0.08,
            0,
            1
        );

        return {
            violationPressure: normalizedPressure,
            stabilityAlignment,
            repeatViolationRate: this.clamp(repeatedViolationCount / 5, 0, 1),
            influenceWeight
        };
    }

    private buildTrustCalibrationCurve(
        currentTrust: number,
        penalty: number,
        repeatedViolationCount: number
    ): TrustCalibrationCurve {
        const immediate = this.clamp(currentTrust * (1 - penalty), 0, 1);
        const shortTerm = this.clamp(immediate + 0.05 - repeatedViolationCount * 0.02, 0, 1);
        const mediumTerm = this.clamp(shortTerm + 0.07 - repeatedViolationCount * 0.015, 0, 1);
        const longTerm = this.clamp(mediumTerm + 0.08 - repeatedViolationCount * 0.01, 0, 1);

        return {
            points: [
                { horizon: 'immediate', trustCoefficient: immediate },
                { horizon: 'short_term', trustCoefficient: shortTerm },
                { horizon: 'medium_term', trustCoefficient: mediumTerm },
                { horizon: 'long_term', trustCoefficient: longTerm }
            ],
            slope: longTerm - immediate,
            confidence: this.clamp(0.9 - penalty * 0.8, 0.2, 0.95)
        };
    }

    private buildSynergyForecasts(
        metrics: CooperativeIntelligenceMetrics,
        repeatedViolationCount: number
    ): SynergyDensityForecast[] {
        const baseline = this.clamp(0.75 * metrics.influenceWeight + 0.2, 0, 1);
        const immediate = this.clamp(
            baseline - metrics.violationPressure * 0.35 - repeatedViolationCount * 0.04,
            0,
            1
        );
        const nearTerm = this.clamp(immediate + metrics.stabilityAlignment * 0.12, 0, 1);
        const longerTerm = this.clamp(nearTerm + metrics.stabilityAlignment * 0.1, 0, 1);
        const confidence = this.clamp(0.85 - repeatedViolationCount * 0.06, 0.25, 0.9);

        return [
            {
                baselineDensity: baseline,
                projectedDensity: immediate,
                confidence,
                horizon: 'immediate'
            },
            {
                baselineDensity: baseline,
                projectedDensity: nearTerm,
                confidence: this.clamp(confidence - 0.04, 0.2, 0.9),
                horizon: 'near_term'
            },
            {
                baselineDensity: baseline,
                projectedDensity: longerTerm,
                confidence: this.clamp(confidence - 0.08, 0.15, 0.9),
                horizon: 'long_term'
            }
        ];
    }

    private rebalanceTaskFormation(
        baseline: TaskFormationProbabilityMap,
        penalty: number
    ): TaskFormationProbabilityMap {
        const shifted: TaskFormationProbabilityMap = {
            autonomous: this.clamp(baseline.autonomous - penalty * 0.55, 0.05, 0.9),
            cooperative: this.clamp(baseline.cooperative - penalty * 0.15, 0.05, 0.9),
            supervised: this.clamp(baseline.supervised + penalty * 0.7, 0.05, 0.9)
        };

        return this.normalizeProbabilities(shifted);
    }

    private normalizeProbabilities(input: TaskFormationProbabilityMap): TaskFormationProbabilityMap {
        const sum = input.autonomous + input.cooperative + input.supervised;
        if (sum <= 0) {
            return { autonomous: 0.34, cooperative: 0.33, supervised: 0.33 };
        }

        return {
            autonomous: this.clamp(input.autonomous / sum, 0, 1),
            cooperative: this.clamp(input.cooperative / sum, 0, 1),
            supervised: this.clamp(input.supervised / sum, 0, 1)
        };
    }

    private severityWeight(severity: ViolationSeverity): number {
        switch (severity) {
            case ViolationSeverity.LOW:
                return 0.25;
            case ViolationSeverity.MEDIUM:
                return 0.5;
            case ViolationSeverity.HIGH:
                return 1;
            case ViolationSeverity.CRITICAL:
                return 1.5;
            default:
                return 0.5;
        }
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }
}

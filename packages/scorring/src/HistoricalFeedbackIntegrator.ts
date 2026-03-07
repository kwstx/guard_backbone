import type { RiskDimension, RiskScoringEngine } from './RiskScoringEngine.js';
import type { ComplianceStageKey, ComplianceEstimator } from './ComplianceEstimator.js';
import type { ImpactSimulationModule, SimulationAssumptions } from './ImpactSimulationModule.js';

export interface HistoricalFeedbackRecord {
    timestamp: Date;
    actionType: string;
    predictedDecisionScore: number; // 0 to 100
    realizedDecisionQuality: number; // 0.0 to 1.0
    predictedSimulation?: {
        realWorldTaskImpact?: number; // -1.0 to 1.0
        predictiveSynergyDensity?: number; // 0.0 to 1.0
        trustWeightedInfluencePropagation?: number; // -1.0 to 1.0
        cooperativeIntelligenceEvolution?: number; // -1.0 to 1.0
    };
    realizedSimulation?: {
        realWorldTaskImpact?: number; // -1.0 to 1.0
        predictiveSynergyDensity?: number; // 0.0 to 1.0
        trustWeightedInfluencePropagation?: number; // -1.0 to 1.0
        cooperativeIntelligenceEvolution?: number; // -1.0 to 1.0
    };
    predictedCompliance?: {
        overallProbability: number;
        lifecycleStageProbabilities?: Partial<Record<ComplianceStageKey, number>>;
    };
    realizedCompliance?: {
        overallObserved: number;
        lifecycleStageObserved?: Partial<Record<ComplianceStageKey, number>>;
    };
}

export interface HistoricalFeedbackIntegratorOptions {
    maxHistorySize?: number;
    weightLearningRate?: number;
    simulationLearningRate?: number;
    complianceLearningRate?: number;
    minimumSampleSize?: number;
}

export interface FeedbackIntegrationReport {
    sampleCount: number;
    meanScoreError: number;
    meanComplianceError: number;
    meanSimulationErrors: {
        taskImpact: number;
        synergy: number;
        trust: number;
        intelligenceEvolution: number;
    };
    appliedWeightDeltas: Partial<Record<RiskDimension, number>>;
    appliedSimulationAssumptionDeltas: Partial<SimulationAssumptions>;
    appliedComplianceCalibration: {
        stageBias: Partial<Record<ComplianceStageKey, number>>;
        actionTypeViolationDeltas: Record<string, number>;
        driftBiasDelta: number;
    };
}

/**
 * Compares predictions against realized outcomes and applies calibrated updates
 * to risk weighting, simulation assumptions, and compliance probability models.
 */
export class HistoricalFeedbackIntegrator {
    private readonly maxHistorySize: number;
    private readonly weightLearningRate: number;
    private readonly simulationLearningRate: number;
    private readonly complianceLearningRate: number;
    private readonly minimumSampleSize: number;
    private history: HistoricalFeedbackRecord[] = [];

    constructor(
        private readonly scoringEngine: RiskScoringEngine,
        private readonly simulationModule: ImpactSimulationModule,
        private readonly complianceEstimator: ComplianceEstimator,
        options: HistoricalFeedbackIntegratorOptions = {}
    ) {
        this.maxHistorySize = options.maxHistorySize ?? 500;
        this.weightLearningRate = options.weightLearningRate ?? 0.2;
        this.simulationLearningRate = options.simulationLearningRate ?? 0.2;
        this.complianceLearningRate = options.complianceLearningRate ?? 0.2;
        this.minimumSampleSize = options.minimumSampleSize ?? 8;
    }

    public integrate(records: HistoricalFeedbackRecord[]): FeedbackIntegrationReport | null {
        if (records.length === 0) {
            return null;
        }

        this.history.push(...records);
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(this.history.length - this.maxHistorySize);
        }

        const sample = this.history.slice(-this.maxHistorySize);
        if (sample.length < this.minimumSampleSize) {
            return null;
        }

        const scoreErrors = sample.map((r) => this.clamp01(r.realizedDecisionQuality) - (this.clamp(r.predictedDecisionScore, 0, 100) / 100));
        const meanScoreError = this.mean(scoreErrors);

        const complianceErrors = sample
            .filter((r) => r.predictedCompliance && r.realizedCompliance)
            .map((r) => this.clamp01(r.realizedCompliance!.overallObserved) - this.clamp01(r.predictedCompliance!.overallProbability));
        const meanComplianceError = complianceErrors.length > 0 ? this.mean(complianceErrors) : 0;

        const simulationErrors = this.computeSimulationErrors(sample);
        const stageBias = this.computeStageBias(sample);
        const actionTypeViolationDeltas = this.computeActionTypeViolationDeltas(sample);

        const weightDeltas = this.deriveWeightDeltas(meanScoreError, meanComplianceError, simulationErrors);
        const simulationAssumptionDeltas = this.deriveSimulationAssumptionDeltas(simulationErrors, scoreErrors);
        const driftBiasDelta = this.deriveDriftBiasDelta(meanComplianceError, stageBias);

        this.scoringEngine.applyAdaptiveMultiplierDeltas(weightDeltas, this.weightLearningRate);
        this.simulationModule.applyAssumptionDeltas(simulationAssumptionDeltas, this.simulationLearningRate);
        this.complianceEstimator.applyHistoricalCalibration(
            {
                stageBias,
                actionTypeViolationDeltas,
                driftBiasDelta,
            },
            this.complianceLearningRate
        );

        return {
            sampleCount: sample.length,
            meanScoreError: Number(meanScoreError.toFixed(4)),
            meanComplianceError: Number(meanComplianceError.toFixed(4)),
            meanSimulationErrors: {
                taskImpact: Number(simulationErrors.taskImpact.toFixed(4)),
                synergy: Number(simulationErrors.synergy.toFixed(4)),
                trust: Number(simulationErrors.trust.toFixed(4)),
                intelligenceEvolution: Number(simulationErrors.intelligenceEvolution.toFixed(4)),
            },
            appliedWeightDeltas: weightDeltas,
            appliedSimulationAssumptionDeltas: simulationAssumptionDeltas,
            appliedComplianceCalibration: {
                stageBias,
                actionTypeViolationDeltas,
                driftBiasDelta: Number(driftBiasDelta.toFixed(4)),
            },
        };
    }

    public getHistory(): HistoricalFeedbackRecord[] {
        return [...this.history];
    }

    private computeSimulationErrors(records: HistoricalFeedbackRecord[]): {
        taskImpact: number;
        synergy: number;
        trust: number;
        intelligenceEvolution: number;
    } {
        const taskErrors: number[] = [];
        const synergyErrors: number[] = [];
        const trustErrors: number[] = [];
        const intelligenceErrors: number[] = [];

        for (const record of records) {
            const predicted = record.predictedSimulation;
            const realized = record.realizedSimulation;
            if (!predicted || !realized) {
                continue;
            }

            if (typeof predicted.realWorldTaskImpact === 'number' && typeof realized.realWorldTaskImpact === 'number') {
                taskErrors.push(realized.realWorldTaskImpact - predicted.realWorldTaskImpact);
            }
            if (typeof predicted.predictiveSynergyDensity === 'number' && typeof realized.predictiveSynergyDensity === 'number') {
                synergyErrors.push(realized.predictiveSynergyDensity - predicted.predictiveSynergyDensity);
            }
            if (typeof predicted.trustWeightedInfluencePropagation === 'number' && typeof realized.trustWeightedInfluencePropagation === 'number') {
                trustErrors.push(realized.trustWeightedInfluencePropagation - predicted.trustWeightedInfluencePropagation);
            }
            if (typeof predicted.cooperativeIntelligenceEvolution === 'number' && typeof realized.cooperativeIntelligenceEvolution === 'number') {
                intelligenceErrors.push(realized.cooperativeIntelligenceEvolution - predicted.cooperativeIntelligenceEvolution);
            }
        }

        return {
            taskImpact: taskErrors.length > 0 ? this.mean(taskErrors) : 0,
            synergy: synergyErrors.length > 0 ? this.mean(synergyErrors) : 0,
            trust: trustErrors.length > 0 ? this.mean(trustErrors) : 0,
            intelligenceEvolution: intelligenceErrors.length > 0 ? this.mean(intelligenceErrors) : 0,
        };
    }

    private computeStageBias(records: HistoricalFeedbackRecord[]): Partial<Record<ComplianceStageKey, number>> {
        const stageErrors: Record<ComplianceStageKey, number[]> = {
            initiation: [],
            execution: [],
            persistence: [],
            termination: [],
        };

        for (const record of records) {
            const predicted = record.predictedCompliance?.lifecycleStageProbabilities;
            const realized = record.realizedCompliance?.lifecycleStageObserved;
            if (!predicted || !realized) {
                continue;
            }

            for (const key of Object.keys(stageErrors) as ComplianceStageKey[]) {
                if (typeof predicted[key] === 'number' && typeof realized[key] === 'number') {
                    stageErrors[key].push(this.clamp01(realized[key]!) - this.clamp01(predicted[key]!));
                }
            }
        }

        const bias: Partial<Record<ComplianceStageKey, number>> = {};
        for (const key of Object.keys(stageErrors) as ComplianceStageKey[]) {
            if (stageErrors[key].length > 0) {
                bias[key] = this.clamp(this.mean(stageErrors[key]), -0.25, 0.25);
            }
        }
        return bias;
    }

    private computeActionTypeViolationDeltas(records: HistoricalFeedbackRecord[]): Record<string, number> {
        const byActionType: Record<string, number[]> = {};

        for (const record of records) {
            if (!record.predictedCompliance || !record.realizedCompliance) {
                continue;
            }

            const error =
                this.clamp01(record.realizedCompliance.overallObserved) -
                this.clamp01(record.predictedCompliance.overallProbability);
            if (!byActionType[record.actionType]) {
                byActionType[record.actionType] = [];
            }
            byActionType[record.actionType].push(error);
        }

        const deltas: Record<string, number> = {};
        for (const actionType of Object.keys(byActionType)) {
            const avgError = this.mean(byActionType[actionType]);
            deltas[actionType] = this.clamp(-avgError * 0.8, -0.25, 0.25);
        }
        return deltas;
    }

    private deriveWeightDeltas(
        meanScoreError: number,
        meanComplianceError: number,
        simulationErrors: { taskImpact: number; synergy: number; trust: number; intelligenceEvolution: number; }
    ): Partial<Record<RiskDimension, number>> {
        const overconfidence = this.clamp(-meanScoreError, 0, 1);
        const underconfidence = this.clamp(meanScoreError, 0, 1);
        const complianceMiss = this.clamp(-meanComplianceError, 0, 1);
        const simulationMiss = this.clamp(
            Math.abs(simulationErrors.taskImpact) * 0.4 +
            Math.abs(simulationErrors.synergy) * 0.2 +
            Math.abs(simulationErrors.trust) * 0.2 +
            Math.abs(simulationErrors.intelligenceEvolution) * 0.2,
            0,
            1
        );

        return {
            operationalRisk: (overconfidence * 0.9) - (underconfidence * 0.4),
            regulatoryExposure: (overconfidence * 0.8) + (complianceMiss * 1.1) - (underconfidence * 0.3),
            financialCost: (overconfidence * 0.25) - (underconfidence * 0.15),
            reputationalImpact: (overconfidence * 0.5) + (complianceMiss * 0.4),
            cooperativeSystemStability: (overconfidence * 0.7) + (simulationMiss * 0.4),
            predictedComplianceProbability: (complianceMiss * 1.2) - (underconfidence * 0.2),
            simulationImpact: (simulationMiss * 0.9) - (underconfidence * 0.2),
            opportunityCostProjection: (underconfidence * 0.4) - (overconfidence * 0.6),
            strategicMisalignment: (overconfidence * 0.35) - (underconfidence * 0.2),
        };
    }

    private deriveSimulationAssumptionDeltas(
        simulationErrors: { taskImpact: number; synergy: number; trust: number; intelligenceEvolution: number; },
        scoreErrors: number[]
    ): Partial<SimulationAssumptions> {
        const taskError = simulationErrors.taskImpact;
        const synergyError = simulationErrors.synergy;
        const trustError = simulationErrors.trust;
        const intelligenceError = simulationErrors.intelligenceEvolution;
        const uncertainty = this.clamp(this.stdDev(scoreErrors), 0, 0.4);

        return {
            taskCriticalityWeight: taskError * 0.5,
            taskIntentClarityWeight: taskError * 0.25,
            excessiveResourcePenalty: -taskError * 0.4,
            synergyPermissionWeight: synergyError * 0.3,
            synergyLayerWeight: synergyError * 0.35,
            trustBase: trustError * 0.35,
            trustPolicyExposurePenaltyWeight: -trustError * 0.3,
            intelligenceSynergyWeight: intelligenceError * 0.3,
            intelligenceStabilityWeight: intelligenceError * 0.25,
            impactfulPermissionBoost: intelligenceError * 0.25,
            noiseAmplitude: (uncertainty - 0.12) * 0.5,
        };
    }

    private deriveDriftBiasDelta(
        meanComplianceError: number,
        stageBias: Partial<Record<ComplianceStageKey, number>>
    ): number {
        const persistenceBias = stageBias.persistence ?? 0;
        return this.clamp((-meanComplianceError * 0.6) + (-persistenceBias * 0.4), -0.25, 0.25);
    }

    private mean(values: number[]): number {
        if (values.length === 0) {
            return 0;
        }
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    private stdDev(values: number[]): number {
        if (values.length <= 1) {
            return 0;
        }
        const mean = this.mean(values);
        const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    private clamp01(value: number): number {
        return this.clamp(value, 0, 1);
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }
}

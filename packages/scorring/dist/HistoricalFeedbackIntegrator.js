/**
 * Compares predictions against realized outcomes and applies calibrated updates
 * to risk weighting, simulation assumptions, and compliance probability models.
 */
export class HistoricalFeedbackIntegrator {
    scoringEngine;
    simulationModule;
    complianceEstimator;
    maxHistorySize;
    weightLearningRate;
    simulationLearningRate;
    complianceLearningRate;
    minimumSampleSize;
    history = [];
    constructor(scoringEngine, simulationModule, complianceEstimator, options = {}) {
        this.scoringEngine = scoringEngine;
        this.simulationModule = simulationModule;
        this.complianceEstimator = complianceEstimator;
        this.maxHistorySize = options.maxHistorySize ?? 500;
        this.weightLearningRate = options.weightLearningRate ?? 0.2;
        this.simulationLearningRate = options.simulationLearningRate ?? 0.2;
        this.complianceLearningRate = options.complianceLearningRate ?? 0.2;
        this.minimumSampleSize = options.minimumSampleSize ?? 8;
    }
    integrate(records) {
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
            .map((r) => this.clamp01(r.realizedCompliance.overallObserved) - this.clamp01(r.predictedCompliance.overallProbability));
        const meanComplianceError = complianceErrors.length > 0 ? this.mean(complianceErrors) : 0;
        const simulationErrors = this.computeSimulationErrors(sample);
        const stageBias = this.computeStageBias(sample);
        const actionTypeViolationDeltas = this.computeActionTypeViolationDeltas(sample);
        const weightDeltas = this.deriveWeightDeltas(meanScoreError, meanComplianceError, simulationErrors);
        const simulationAssumptionDeltas = this.deriveSimulationAssumptionDeltas(simulationErrors, scoreErrors);
        const driftBiasDelta = this.deriveDriftBiasDelta(meanComplianceError, stageBias);
        this.scoringEngine.applyAdaptiveMultiplierDeltas(weightDeltas, this.weightLearningRate);
        this.simulationModule.applyAssumptionDeltas(simulationAssumptionDeltas, this.simulationLearningRate);
        this.complianceEstimator.applyHistoricalCalibration({
            stageBias,
            actionTypeViolationDeltas,
            driftBiasDelta,
        }, this.complianceLearningRate);
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
    getHistory() {
        return [...this.history];
    }
    computeSimulationErrors(records) {
        const taskErrors = [];
        const synergyErrors = [];
        const trustErrors = [];
        const intelligenceErrors = [];
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
    computeStageBias(records) {
        const stageErrors = {
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
            for (const key of Object.keys(stageErrors)) {
                if (typeof predicted[key] === 'number' && typeof realized[key] === 'number') {
                    stageErrors[key].push(this.clamp01(realized[key]) - this.clamp01(predicted[key]));
                }
            }
        }
        const bias = {};
        for (const key of Object.keys(stageErrors)) {
            if (stageErrors[key].length > 0) {
                bias[key] = this.clamp(this.mean(stageErrors[key]), -0.25, 0.25);
            }
        }
        return bias;
    }
    computeActionTypeViolationDeltas(records) {
        const byActionType = {};
        for (const record of records) {
            if (!record.predictedCompliance || !record.realizedCompliance) {
                continue;
            }
            const error = this.clamp01(record.realizedCompliance.overallObserved) -
                this.clamp01(record.predictedCompliance.overallProbability);
            if (!byActionType[record.actionType]) {
                byActionType[record.actionType] = [];
            }
            byActionType[record.actionType].push(error);
        }
        const deltas = {};
        for (const actionType of Object.keys(byActionType)) {
            const avgError = this.mean(byActionType[actionType]);
            deltas[actionType] = this.clamp(-avgError * 0.8, -0.25, 0.25);
        }
        return deltas;
    }
    deriveWeightDeltas(meanScoreError, meanComplianceError, simulationErrors) {
        const overconfidence = this.clamp(-meanScoreError, 0, 1);
        const underconfidence = this.clamp(meanScoreError, 0, 1);
        const complianceMiss = this.clamp(-meanComplianceError, 0, 1);
        const simulationMiss = this.clamp(Math.abs(simulationErrors.taskImpact) * 0.4 +
            Math.abs(simulationErrors.synergy) * 0.2 +
            Math.abs(simulationErrors.trust) * 0.2 +
            Math.abs(simulationErrors.intelligenceEvolution) * 0.2, 0, 1);
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
    deriveSimulationAssumptionDeltas(simulationErrors, scoreErrors) {
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
    deriveDriftBiasDelta(meanComplianceError, stageBias) {
        const persistenceBias = stageBias.persistence ?? 0;
        return this.clamp((-meanComplianceError * 0.6) + (-persistenceBias * 0.4), -0.25, 0.25);
    }
    mean(values) {
        if (values.length === 0) {
            return 0;
        }
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    stdDev(values) {
        if (values.length <= 1) {
            return 0;
        }
        const mean = this.mean(values);
        const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
        return Math.sqrt(variance);
    }
    clamp01(value) {
        return this.clamp(value, 0, 1);
    }
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}

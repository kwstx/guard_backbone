/**
 * Computes a context-aware composite risk score across multiple dimensions.
 * Weighting is dynamically recalibrated on each call based on context + system state.
 */
export class RiskScoringEngine {
    baseWeights = {
        operationalRisk: 1.0,
        regulatoryExposure: 1.0,
        financialCost: 0.8,
        reputationalImpact: 0.9,
        cooperativeSystemStability: 1.0,
        predictedComplianceProbability: 1.1,
        simulationImpact: 1.2,
        opportunityCostProjection: 1.0,
        strategicMisalignment: 1.15,
    };
    /**
     * Adaptive multipliers are nudged by feedback to gradually calibrate behavior over time.
     */
    adaptiveMultipliers = {
        operationalRisk: 1.0,
        regulatoryExposure: 1.0,
        financialCost: 1.0,
        reputationalImpact: 1.0,
        cooperativeSystemStability: 1.0,
        predictedComplianceProbability: 1.0,
        simulationImpact: 1.0,
        opportunityCostProjection: 1.0,
        strategicMisalignment: 1.0,
    };
    getAdaptiveMultipliersSnapshot() {
        return { ...this.adaptiveMultipliers };
    }
    /**
     * Applies aggregated historical calibration deltas to adaptive multipliers.
     * Positive delta increases emphasis on the corresponding dimension.
     */
    applyAdaptiveMultiplierDeltas(deltas, learningRate = 0.15) {
        const lr = this.clamp(learningRate, 0.01, 0.5);
        for (const key of Object.keys(deltas)) {
            const delta = deltas[key];
            if (typeof delta !== 'number' || !Number.isFinite(delta)) {
                continue;
            }
            this.adaptiveMultipliers[key] = this.clamp(this.adaptiveMultipliers[key] + (delta * lr), 0.5, 2.5);
        }
    }
    scoreDecision(decision, context, systemState) {
        const dimensionScores = this.computeDimensionScores(decision, context, systemState);
        const weights = this.recalibrateWeights(decision, context, systemState);
        // Risk dimensions are all "higher means riskier".
        const riskDimensions = [
            'operationalRisk',
            'regulatoryExposure',
            'financialCost',
            'reputationalImpact',
            'cooperativeSystemStability',
            'strategicMisalignment',
        ];
        let weightedRiskSum = 0;
        let riskWeightSum = 0;
        for (const key of riskDimensions) {
            weightedRiskSum += dimensionScores[key] * weights[key];
            riskWeightSum += weights[key];
        }
        const weightedRisk = riskWeightSum > 0 ? weightedRiskSum / riskWeightSum : 0;
        const weightedCompliance = this.clamp01(dimensionScores.predictedComplianceProbability * weights.predictedComplianceProbability);
        const weightedSimulation = this.clamp01(dimensionScores.simulationImpact * weights.simulationImpact);
        const weightedOpportunity = this.clamp01(dimensionScores.opportunityCostProjection * weights.opportunityCostProjection);
        const weightedStrategicMisalignment = this.clamp01(dimensionScores.strategicMisalignment * weights.strategicMisalignment);
        const preemptiveRiskLiftApplied = this.clamp01(context.preemptiveRiskLift ?? 0);
        // Decision score favors high compliance, high simulation impact,
        // high opportunity cost of blocking, low risk pressure, and low strategic misalignment.
        const baseRiskPressure = this.clamp01((weightedRisk * 0.45) +
            ((1 - weightedCompliance) * 0.13) +
            ((1 - weightedSimulation) * 0.12) +
            ((1 - weightedOpportunity) * 0.12) +
            (weightedStrategicMisalignment * 0.18));
        const preemptiveRiskPressureDelta = preemptiveRiskLiftApplied * 0.55;
        const riskPressure = this.clamp01(baseRiskPressure + preemptiveRiskPressureDelta);
        const decisionScore = this.clamp01(1 - riskPressure) * 100;
        return {
            decisionScore: Number(decisionScore.toFixed(2)),
            riskPressure: Number(riskPressure.toFixed(4)),
            breakdown: {
                dimensionScores,
                weights,
                weightedRisk: Number(weightedRisk.toFixed(4)),
                weightedCompliance: Number(weightedCompliance.toFixed(4)),
                weightedSimulation: Number(weightedSimulation.toFixed(4)),
                weightedOpportunity: Number(weightedOpportunity.toFixed(4)),
                weightedStrategicMisalignment: Number(weightedStrategicMisalignment.toFixed(4)),
                preemptiveRiskLiftApplied: Number(preemptiveRiskLiftApplied.toFixed(4)),
                preemptiveRiskPressureDelta: Number(preemptiveRiskPressureDelta.toFixed(4)),
            }
        };
    }
    /**
     * Feedback loop for online recalibration. If real-world outcome diverges from prediction,
     * corresponding multipliers are adjusted to reduce future error.
     */
    updateCalibrationFromFeedback(predicted, actualOutcome, learningRate = 0.05) {
        const lr = this.clamp(learningRate, 0.005, 0.2);
        const observedCompliance = this.clamp01(actualOutcome.complianceObserved);
        const predictedCompliance = predicted.breakdown.dimensionScores.predictedComplianceProbability;
        const complianceError = observedCompliance - predictedCompliance;
        // If compliance was worse than predicted, increase emphasis on regulatory + operational signals.
        this.adaptiveMultipliers.regulatoryExposure = this.clamp(this.adaptiveMultipliers.regulatoryExposure + (-complianceError * lr), 0.5, 2.5);
        this.adaptiveMultipliers.operationalRisk = this.clamp(this.adaptiveMultipliers.operationalRisk + (-complianceError * lr * 0.7), 0.5, 2.5);
        if (actualOutcome.stabilityIncidentOccurred) {
            this.adaptiveMultipliers.cooperativeSystemStability = this.clamp(this.adaptiveMultipliers.cooperativeSystemStability + lr, 0.5, 2.5);
            this.adaptiveMultipliers.reputationalImpact = this.clamp(this.adaptiveMultipliers.reputationalImpact + (lr * 0.6), 0.5, 2.5);
        }
        if (actualOutcome.costOverrunRatio > 1) {
            const overrunPenalty = this.clamp((actualOutcome.costOverrunRatio - 1) * lr, 0, 0.25);
            this.adaptiveMultipliers.financialCost = this.clamp(this.adaptiveMultipliers.financialCost + overrunPenalty, 0.5, 2.5);
        }
        // If predictions were overly pessimistic and outcomes were good, relax compliance emphasis slightly.
        if (complianceError > 0.1 && !actualOutcome.stabilityIncidentOccurred) {
            this.adaptiveMultipliers.predictedComplianceProbability = this.clamp(this.adaptiveMultipliers.predictedComplianceProbability - (lr * 0.4), 0.5, 2.5);
        }
    }
    computeDimensionScores(decision, context, systemState) {
        const operationalRisk = this.computeOperationalRisk(decision, systemState);
        const regulatoryExposure = this.computeRegulatoryExposure(decision, context);
        const financialCost = this.computeFinancialCost(decision, context);
        const reputationalImpact = this.computeReputationalImpact(decision, systemState);
        const cooperativeSystemStability = this.computeCooperativeSystemStability(decision, systemState);
        const predictedComplianceProbability = this.computePredictedCompliance(decision, context, systemState);
        const simulationImpact = this.computeSimulationImpact(decision);
        const opportunityCostProjection = this.computeOpportunityCostProjection(decision, context);
        const strategicMisalignment = this.computeStrategicMisalignment(decision);
        return {
            operationalRisk,
            regulatoryExposure,
            financialCost,
            reputationalImpact,
            cooperativeSystemStability,
            predictedComplianceProbability,
            simulationImpact,
            opportunityCostProjection,
            strategicMisalignment,
        };
    }
    recalibrateWeights(decision, context, systemState) {
        const weights = {
            operationalRisk: this.baseWeights.operationalRisk,
            regulatoryExposure: this.baseWeights.regulatoryExposure,
            financialCost: this.baseWeights.financialCost,
            reputationalImpact: this.baseWeights.reputationalImpact,
            cooperativeSystemStability: this.baseWeights.cooperativeSystemStability,
            predictedComplianceProbability: this.baseWeights.predictedComplianceProbability,
            simulationImpact: this.baseWeights.simulationImpact,
            opportunityCostProjection: this.baseWeights.opportunityCostProjection,
            strategicMisalignment: this.baseWeights.strategicMisalignment,
        };
        // System-state sensitivity.
        weights.cooperativeSystemStability *= 1 + (systemState.loadFactor * 0.8);
        weights.operationalRisk *= 1 + (systemState.loadFactor * 0.4);
        if (systemState.incidentActive) {
            weights.cooperativeSystemStability *= 1.35;
            weights.reputationalImpact *= 1.2;
        }
        if (systemState.regulatoryAlert) {
            weights.regulatoryExposure *= 1.4;
            weights.predictedComplianceProbability *= 1.25;
            weights.reputationalImpact *= 1.1;
        }
        // Decision-specific sensitivity.
        const sensitivePermission = decision.authorityScope.permissions.some((p) => ['WRITE', 'DELETE', 'ADMIN', 'EXECUTE'].includes(p.toUpperCase()));
        if (sensitivePermission) {
            weights.operationalRisk *= 1.15;
            weights.regulatoryExposure *= 1.1;
            weights.strategicMisalignment *= 1.1; // Sensitive actions get extra strategic scrutiny
        }
        // Contextual multipliers.
        const budgetPressure = this.clamp01(context.budgetPressure ?? 0);
        weights.financialCost *= 1 + (budgetPressure * 0.9);
        weights.opportunityCostProjection *= 1 + ((1 - budgetPressure) * 0.35);
        const dataSensitivity = this.clamp01(context.dataSensitivity ?? 0);
        weights.regulatoryExposure *= 1 + (dataSensitivity * 0.7);
        weights.reputationalImpact *= 1 + (dataSensitivity * 0.5);
        weights.opportunityCostProjection *= 1 + ((1 - dataSensitivity) * 0.15);
        // User-supplied strategic priorities.
        if (context.dimensionPriorities) {
            for (const key of Object.keys(context.dimensionPriorities)) {
                const boost = context.dimensionPriorities[key];
                if (typeof boost === 'number' && Number.isFinite(boost) && boost > 0) {
                    weights[key] *= boost;
                }
            }
        }
        // Learned adaptation.
        for (const key of Object.keys(weights)) {
            weights[key] *= this.adaptiveMultipliers[key];
        }
        return this.normalizeWeights(weights);
    }
    normalizeWeights(weights) {
        let sum = 0;
        for (const key of Object.keys(weights)) {
            weights[key] = Math.max(0, weights[key]);
            sum += weights[key];
        }
        if (sum <= 0) {
            const uniform = 1 / 9;
            return {
                operationalRisk: uniform,
                regulatoryExposure: uniform,
                financialCost: uniform,
                reputationalImpact: uniform,
                cooperativeSystemStability: uniform,
                predictedComplianceProbability: uniform,
                simulationImpact: uniform,
                opportunityCostProjection: uniform,
                strategicMisalignment: uniform,
            };
        }
        for (const key of Object.keys(weights)) {
            weights[key] = weights[key] / sum;
        }
        return weights;
    }
    computeOperationalRisk(decision, systemState) {
        let resourcePressure = 0;
        for (const resource of decision.requiredResources) {
            const criticalityFactor = resource.criticality === 'HIGH' ? 1.0 :
                resource.criticality === 'MEDIUM' ? 0.6 : 0.3;
            resourcePressure += criticalityFactor * Math.min(resource.amount / 1000, 1);
        }
        const permissionBreadth = Math.min(decision.authorityScope.permissions.length / 5, 1);
        const loadAmplifier = this.clamp01(systemState.loadFactor);
        const computedResourceRisk = this.clamp01((decision.resourceAnalysis.computationalCostScore * 0.7) +
            (Math.min(decision.resourceAnalysis.bandwidthUtilizationMbps / 100, 1) * 0.3));
        return this.clamp01((resourcePressure * 0.35) +
            (permissionBreadth * 0.2) +
            (loadAmplifier * 0.15) +
            (computedResourceRisk * 0.3));
    }
    computeRegulatoryExposure(decision, context) {
        if (decision.policyExposure.length === 0) {
            return 0;
        }
        let exposureSum = 0;
        let violationCount = 0;
        for (const exposure of decision.policyExposure) {
            exposureSum += this.clamp01(exposure.exposureLevel);
            violationCount += exposure.potentialViolations.length;
        }
        const avgExposure = exposureSum / decision.policyExposure.length;
        const violationFactor = Math.min(violationCount / 10, 1);
        const sensitivityAmplifier = this.clamp01(context.dataSensitivity ?? 0);
        return this.clamp01((avgExposure * 0.7) + (violationFactor * 0.2) + (sensitivityAmplifier * 0.1));
    }
    computeFinancialCost(decision, context) {
        if (decision.resourceAnalysis?.estimatedFinancialExpenditureUSD !== undefined) {
            const normalizedCost = Math.min(decision.resourceAnalysis.estimatedFinancialExpenditureUSD / 100, 1);
            const budgetPressure = this.clamp01(context.budgetPressure ?? 0);
            return this.clamp01((normalizedCost * 0.75) + (budgetPressure * 0.25));
        }
        const unitCostMap = {
            CPU: 0.002,
            API_CALL: 0.01,
            NETWORK_EGRESS_MB: 0.0015,
            STORAGE_GB: 0.02,
            HUMAN_REVIEW_MINUTES: 0.4,
        };
        let estimatedCost = 0;
        for (const resource of decision.requiredResources) {
            const unitCost = unitCostMap[resource.type] ?? 0.005;
            estimatedCost += resource.amount * unitCost;
        }
        const normalizedCost = Math.min(estimatedCost / 100, 1);
        const budgetPressure = this.clamp01(context.budgetPressure ?? 0);
        return this.clamp01((normalizedCost * 0.75) + (budgetPressure * 0.25));
    }
    computeReputationalImpact(decision, systemState) {
        const policyViolationSignal = Math.min(decision.policyExposure.reduce((acc, p) => acc + p.potentialViolations.length, 0) / 8, 1);
        // Negative trust propagation values indicate harmful spread.
        const trustPropagation = this.clamp01(Math.max(0, -decision.projectedImpact.trustWeightedPropagation));
        const incidentAmplifier = systemState.incidentActive ? 0.2 : 0;
        return this.clamp01((policyViolationSignal * 0.5) + (trustPropagation * 0.3) + incidentAmplifier);
    }
    computeCooperativeSystemStability(decision, systemState) {
        const inverseProjectedStability = this.clamp01((1 - decision.projectedImpact.systemStabilityScore) / 2);
        const recoveryPenalty = Math.min(decision.projectedImpact.estimatedRecoveryTimeSeconds / 3600, 1);
        const backlogPenalty = Math.min(systemState.recoveryBacklogSeconds / 7200, 1);
        return this.clamp01((inverseProjectedStability * 0.5) + (recoveryPenalty * 0.3) + (backlogPenalty * 0.2));
    }
    computePredictedCompliance(decision, context, systemState) {
        // If an advanced forecast is available from the ComplianceEstimator, prioritize it.
        if (decision.complianceForecast) {
            return decision.complianceForecast.overallProbability;
        }
        const policyRisk = this.computeRegulatoryExposure(decision, context);
        const operationalRisk = this.computeOperationalRisk(decision, systemState);
        const historicalCompliance = this.clamp01(context.historicalComplianceRate ?? 0.5);
        // Higher policy/operational risk lowers predicted compliance probability.
        const predicted = (historicalCompliance * 0.6) + ((1 - policyRisk) * 0.25) + ((1 - operationalRisk) * 0.15);
        return this.clamp01(predicted);
    }
    computeSimulationImpact(decision) {
        const impact = decision.projectedImpact;
        // Normalize -1..1 metrics to 0..1
        const taskImpact = (impact.realWorldTaskImpact + 1) / 2;
        const synergy = impact.predictiveSynergyDensity;
        const trust = (impact.trustWeightedPropagation + 1) / 2;
        const evolution = (impact.cooperativeIntelligenceEvolution + 1) / 2;
        return this.clamp01((taskImpact * 0.4) +
            (synergy * 0.2) +
            (trust * 0.2) +
            (evolution * 0.2));
    }
    computeOpportunityCostProjection(decision, context) {
        const normalizedBlockingCost = this.clamp01(decision.resourceAnalysis.projectedOpportunityCostOfBlockingUSD / 300);
        const tradeoffScore = this.clamp01(decision.resourceAnalysis.opportunityTradeoffScore);
        const efficiency = this.clamp01(decision.resourceAnalysis.economicEfficiencyScore);
        const budgetPressure = this.clamp01(context.budgetPressure ?? 0);
        // Budget pressure dampens willingness to pay opportunity premiums.
        return this.clamp01((normalizedBlockingCost * 0.5) +
            (tradeoffScore * 0.3) +
            (efficiency * 0.2) -
            (budgetPressure * 0.15));
    }
    /**
     * Computes strategic misalignment risk. Uses the StrategicAlignmentModule's penalty
     * when a strategicAlignment assessment is present on the decision; otherwise
     * falls back to a lightweight heuristic based on action characteristics.
     */
    computeStrategicMisalignment(decision) {
        // If the StrategicAlignmentModule has already evaluated this decision, use its penalty directly.
        if (decision.strategicAlignment) {
            return this.clamp01(decision.strategicAlignment.misalignmentPenalty);
        }
        // Fallback heuristic: actions with vague intent and high authority scope
        // are more likely to drift from strategic objectives.
        const intentClarity = (decision.intent?.length || 0) > 40 ? 0.1 : 0.35;
        const permissionBreadth = Math.min(decision.authorityScope.permissions.length / 5, 1) * 0.25;
        const policyExposurePenalty = decision.policyExposure.length > 0
            ? decision.policyExposure.reduce((sum, p) => sum + p.exposureLevel, 0) /
                decision.policyExposure.length * 0.2
            : 0;
        return this.clamp01(intentClarity + permissionBreadth + policyExposurePenalty);
    }
    clamp01(value) {
        return this.clamp(value, 0, 1);
    }
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}

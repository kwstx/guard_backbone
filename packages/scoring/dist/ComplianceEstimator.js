/**
 * ComplianceEstimator calculates the probability that an action will remain compliant
 * across its full lifecycle, from initiation to eventual termination.
 */
export class ComplianceEstimator {
    policies = new Map();
    violationPatterns = [];
    authorityGraph = { nodes: [], edges: [] };
    stageBias = {
        initiation: 0,
        execution: 0,
        persistence: 0,
        termination: 0,
    };
    actionTypeViolationBias = new Map();
    driftBias = 0;
    constructor() {
        this.loadDefaultPolicies();
        this.loadDefaultPatterns();
    }
    /**
     * Produces a probabilistic compliance forecast for a given decision.
     */
    estimateCompliance(decision) {
        console.log(`[ComplianceEstimator] Estimating lifecycle compliance for decision: ${decision.id}`);
        const initiationProb = this.calculateInitiationCompliance(decision);
        const executionProb = this.calculateExecutionCompliance(decision);
        const persistenceProb = this.calculatePersistenceCompliance(decision);
        const terminationProb = this.calculateTerminationCompliance(decision);
        const lifecycleStageProbabilities = {
            initiation: initiationProb,
            execution: executionProb,
            persistence: persistenceProb,
            termination: terminationProb
        };
        // Overall probability is the product of stage probabilities (assuming independent risks for simplicity, 
        // or a weighted average if stages are considered conditional).
        // Here we use a weighted geometric mean to emphasize that failure in any stage is critical.
        const overallProbability = this.calculateOverallProbability(lifecycleStageProbabilities);
        const primaryRiskDrivers = this.identifyRiskDrivers(decision, lifecycleStageProbabilities);
        const estimatedDriftImpact = this.calculateDriftImpact(decision);
        return {
            overallProbability: Number(overallProbability.toFixed(4)),
            lifecycleStageProbabilities: {
                initiation: Number(initiationProb.toFixed(4)),
                execution: Number(executionProb.toFixed(4)),
                persistence: Number(persistenceProb.toFixed(4)),
                termination: Number(terminationProb.toFixed(4))
            },
            primaryRiskDrivers,
            estimatedDriftImpact: Number(estimatedDriftImpact.toFixed(4)),
            timestamp: new Date()
        };
    }
    getCalibrationSnapshot() {
        const actionTypeViolationBias = {};
        for (const [actionType, bias] of this.actionTypeViolationBias.entries()) {
            actionTypeViolationBias[actionType] = bias;
        }
        return {
            stageBias: { ...this.stageBias },
            actionTypeViolationBias,
            driftBias: this.driftBias,
        };
    }
    /**
     * Applies bounded deltas to probabilistic compliance model parameters.
     */
    applyHistoricalCalibration(deltas, learningRate = 0.2) {
        const lr = this.clamp(learningRate, 0.01, 0.5);
        if (deltas.stageBias) {
            for (const key of Object.keys(deltas.stageBias)) {
                const delta = deltas.stageBias[key];
                if (typeof delta !== 'number' || !Number.isFinite(delta)) {
                    continue;
                }
                this.stageBias[key] = this.clamp(this.stageBias[key] + (delta * lr), -0.35, 0.35);
            }
        }
        if (deltas.actionTypeViolationDeltas) {
            for (const actionType of Object.keys(deltas.actionTypeViolationDeltas)) {
                const delta = deltas.actionTypeViolationDeltas[actionType];
                if (typeof delta !== 'number' || !Number.isFinite(delta)) {
                    continue;
                }
                const current = this.actionTypeViolationBias.get(actionType) ?? 0;
                this.actionTypeViolationBias.set(actionType, this.clamp(current + (delta * lr), -0.4, 0.4));
            }
        }
        if (typeof deltas.driftBiasDelta === 'number' && Number.isFinite(deltas.driftBiasDelta)) {
            this.driftBias = this.clamp(this.driftBias + (deltas.driftBiasDelta * lr), -0.3, 0.3);
        }
    }
    calculateInitiationCompliance(decision) {
        // Initiation compliance depends on authority alignment and initial policy exposure.
        const authorityScore = this.evaluateAuthorityAlignment(decision);
        const exposureScore = 1 - (decision.policyExposure.reduce((acc, p) => acc + p.exposureLevel, 0) / Math.max(1, decision.policyExposure.length));
        // Historical patterns at initiation
        const patternFactor = this.getViolationPatternFactor(decision, 'INITIATION');
        const base = (authorityScore * 0.4) + (exposureScore * 0.4) + (patternFactor * 0.2);
        return this.clamp01(base + this.stageBias.initiation);
    }
    calculateExecutionCompliance(decision) {
        // Execution compliance depends on resource criticality and potential for runtime violations.
        const resourcePressure = decision.requiredResources.reduce((acc, r) => acc + (r.criticality === 'HIGH' ? 0.3 : r.criticality === 'MEDIUM' ? 0.1 : 0.05), 0);
        const stabilityFactor = (decision.projectedImpact.systemStabilityScore + 1) / 2;
        const patternFactor = this.getViolationPatternFactor(decision, 'EXECUTION');
        const base = stabilityFactor * (1 - Math.min(resourcePressure, 0.5)) * patternFactor;
        return this.clamp01(base + this.stageBias.execution);
    }
    calculatePersistenceCompliance(decision) {
        // Persistence compliance factors in technical debt, state drift, and long-term policy alignment.
        const driftFactor = decision.policyExposure.reduce((acc, p) => {
            const policy = this.policies.get(p.policyId);
            return acc + (policy?.driftFactor ?? 0.1);
        }, 0) / Math.max(1, decision.policyExposure.length);
        const trustPropagation = (decision.projectedImpact.trustWeightedPropagation + 1) / 2;
        const patternFactor = this.getViolationPatternFactor(decision, 'PERSISTENCE');
        const base = (trustPropagation * 0.7) * (1 - driftFactor) * patternFactor;
        return this.clamp01(base + this.stageBias.persistence);
    }
    calculateTerminationCompliance(decision) {
        // Termination compliance relates to clean-up, resource release, and auditability.
        const recoveryFactor = Math.max(0, 1 - (decision.projectedImpact.estimatedRecoveryTimeSeconds / 3600));
        const synergyFactor = decision.projectedImpact.predictiveSynergyDensity;
        const patternFactor = this.getViolationPatternFactor(decision, 'TERMINATION');
        const base = (recoveryFactor * 0.5) + (synergyFactor * 0.3) + (patternFactor * 0.2);
        return this.clamp01(base + this.stageBias.termination);
    }
    evaluateAuthorityAlignment(decision) {
        // Check if the agent's delegation chain and permissions match the authority graph nodes.
        // Placeholder logic: if delegation chain exists and permissions aren't 'ADMIN', it's safer.
        const hasDelegation = (decision.authorityScope.delegationChain?.length ?? 0) > 0;
        const isNotAdmin = !decision.authorityScope.permissions.includes('ADMIN');
        return hasDelegation ? (isNotAdmin ? 0.95 : 0.8) : (isNotAdmin ? 0.85 : 0.6);
    }
    getViolationPatternFactor(decision, stage) {
        const relevantPatterns = this.violationPatterns.filter(p => p.lifecycleStage === stage &&
            p.associatedActionTypes.includes(decision.actionType));
        if (relevantPatterns.length === 0)
            return 1.0;
        // Multiply safety by inverse of maximum violation probability found
        const maxViolationProb = Math.max(...relevantPatterns.map(p => p.violationProbability));
        const actionTypeBias = this.actionTypeViolationBias.get(decision.actionType) ?? 0;
        return 1 - this.clamp01(maxViolationProb + actionTypeBias);
    }
    calculateOverallProbability(probs) {
        // Weighted geometric mean or simple product
        return Math.pow(probs.initiation * probs.execution * probs.persistence * probs.termination, 1 / 4);
    }
    identifyRiskDrivers(decision, probs) {
        const drivers = [];
        if (probs.initiation < 0.8)
            drivers.push('Authority Scope Ambiguity');
        if (probs.execution < 0.8)
            drivers.push('High Resource Criticality Pressure');
        if (probs.persistence < 0.8)
            drivers.push('High Policy Drift Potential');
        if (probs.termination < 0.8)
            drivers.push('Extended Recovery Debt');
        if (decision.policyExposure.some(p => p.exposureLevel > 0.7)) {
            drivers.push('Severe Policy Exposure');
        }
        return drivers;
    }
    calculateDriftImpact(decision) {
        const baseDrift = decision.policyExposure.reduce((acc, p) => {
            const policy = this.policies.get(p.policyId);
            return acc + (policy?.driftFactor ?? 0.05);
        }, 0) / Math.max(1, decision.policyExposure.length);
        return this.clamp01(baseDrift + this.driftBias);
    }
    clamp01(val) {
        return Math.min(Math.max(val, 0), 1);
    }
    clamp(val, min, max) {
        return Math.min(Math.max(val, min), max);
    }
    loadDefaultPolicies() {
        const defaults = [
            { id: 'DEFAULT_SAFETY_GUIDE_V1', description: 'Basic safety constraints', constraintType: 'ACCESS_RESTRICTION', severity: 5, historicalViolationRate: 0.02, driftFactor: 0.05 },
            { id: 'RESOURCE_QUOTA_POLICY', description: 'Limits total resource consumption', constraintType: 'RESOURCE_LIMIT', severity: 7, historicalViolationRate: 0.05, driftFactor: 0.02 },
            { id: 'DATA_PRIVACY_STRICT', description: 'Tight control over PII', constraintType: 'ACCESS_RESTRICTION', severity: 10, historicalViolationRate: 0.01, driftFactor: 0.1 },
            { id: 'TEMPORAL_EXECUTION_LOCK', description: 'Prevents execution during maintenance', constraintType: 'TEMPORAL_LOCK', severity: 4, historicalViolationRate: 0.03, driftFactor: 0.01 }
        ];
        defaults.forEach(p => this.policies.set(p.id, p));
    }
    loadDefaultPatterns() {
        this.violationPatterns = [
            {
                patternId: 'AUTH_DRIFT_01',
                description: 'Permission escalation during execution',
                associatedActionTypes: ['MIGRATE', 'UPDATE', 'EXECUTE'],
                violationProbability: 0.12,
                lifecycleStage: 'EXECUTION'
            },
            {
                patternId: 'CLEANUP_FAILURE',
                description: 'Orphaned resources after termination',
                associatedActionTypes: ['DEPLOY', 'CREATE', 'ALLOCATE'],
                violationProbability: 0.08,
                lifecycleStage: 'TERMINATION'
            },
            {
                patternId: 'LONG_TERM_DEGRADATION',
                description: 'Compliance decay over time due to environment change',
                associatedActionTypes: ['PERSIST', 'MONITOR', 'BACKUP'],
                violationProbability: 0.15,
                lifecycleStage: 'PERSISTENCE'
            }
        ];
    }
}

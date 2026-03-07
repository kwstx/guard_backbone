import type { DecisionObject } from './DecisionObject.js';

export interface SimulationResult {
    realWorldTaskImpact: number;
    predictiveSynergyDensity: number;
    trustWeightedInfluencePropagation: number;
    cooperativeIntelligenceEvolution: number;
}

export interface SimulationAssumptions {
    taskCriticalityWeight: number;
    taskIntentClarityWeight: number;
    excessiveResourcePenalty: number;
    synergyPermissionWeight: number;
    synergyLayerWeight: number;
    trustBase: number;
    trustPolicyExposurePenaltyWeight: number;
    intelligenceSynergyWeight: number;
    intelligenceStabilityWeight: number;
    impactfulPermissionBoost: number;
    noiseAmplitude: number;
}

/**
 * ImpactSimulationModule runs lightweight forward simulations to estimate
 * the downstream consequences of a proposed action.
 */
export class ImpactSimulationModule {
    private assumptions: SimulationAssumptions = {
        taskCriticalityWeight: 0.6,
        taskIntentClarityWeight: 0.4,
        excessiveResourcePenalty: 0.3,
        synergyPermissionWeight: 0.1,
        synergyLayerWeight: 0.2,
        trustBase: 0.5,
        trustPolicyExposurePenaltyWeight: 0.2,
        intelligenceSynergyWeight: 0.5,
        intelligenceStabilityWeight: 0.5,
        impactfulPermissionBoost: 1.2,
        noiseAmplitude: 0.1,
    };

    public getAssumptionsSnapshot(): SimulationAssumptions {
        return { ...this.assumptions };
    }

    /**
     * Applies bounded deltas to simulation assumptions.
     */
    public applyAssumptionDeltas(
        deltas: Partial<SimulationAssumptions>,
        learningRate: number = 0.2
    ): void {
        const lr = this.clamp(learningRate, 0.01, 0.5);

        for (const key of Object.keys(deltas) as Array<keyof SimulationAssumptions>) {
            const delta = deltas[key];
            if (typeof delta !== 'number' || !Number.isFinite(delta)) {
                continue;
            }

            const updated = this.assumptions[key] + (delta * lr);
            this.assumptions[key] = this.clampAssumption(key, updated);
        }
    }

    /**
     * Executes a series of forward-looking simulations for a given decision.
     */
    public simulate(decision: Partial<DecisionObject>): SimulationResult {
        // In a real implementation, this might query a world model or run Monte Carlo simulations.
        // Here we use heuristic-based estimation of downstream effects.

        const realWorldTaskImpact = this.simulateTaskImpact(decision);
        const synergyDensity = this.simulateSynergy(decision);
        const trustPropagation = this.simulateTrustPropagation(decision);
        const intelligenceEvolution = this.simulateIntelligenceEvolution(decision, synergyDensity);

        return {
            realWorldTaskImpact,
            predictiveSynergyDensity: synergyDensity,
            trustWeightedInfluencePropagation: trustPropagation,
            cooperativeIntelligenceEvolution: intelligenceEvolution
        };
    }

    private simulateTaskImpact(decision: Partial<DecisionObject>): number {
        // High resource requirement with LOW criticality often suggests wasteful task impact.
        const totalResources = decision.requiredResources?.reduce((acc, r) => acc + r.amount, 0) || 0;
        const avgCriticality = decision.requiredResources?.length
            ? decision.requiredResources.reduce((acc, r) => acc + (r.criticality === 'HIGH' ? 1 : r.criticality === 'MEDIUM' ? 0.5 : 0.1), 0) / decision.requiredResources.length
            : 0.5;

        // If intent is vague, task impact is likely lower or more risky.
        const intentClarity = (decision.intent?.length || 0) > 20 ? 0.8 : 0.4;

        let impact =
            (avgCriticality * this.assumptions.taskCriticalityWeight) +
            (intentClarity * this.assumptions.taskIntentClarityWeight);

        // Penalize for excessive resource use without clear goal
        if (totalResources > 1000 && intentClarity < 0.5) {
            impact -= this.assumptions.excessiveResourcePenalty;
        }

        return Math.min(Math.max(impact, -1.0), 1.0);
    }

    private simulateSynergy(decision: Partial<DecisionObject>): number {
        // Synergy density increases when permissions are multi-layered (suggesting integration).
        const permissions = decision.authorityScope?.permissions?.length || 0;
        const layers = decision.authorityScope?.layer ? 1 : 0;

        let synergy =
            (permissions * this.assumptions.synergyPermissionWeight) +
            (layers * this.assumptions.synergyLayerWeight);

        // Random "system noise" to simulate dynamic environments
        synergy += (Math.random() * (this.assumptions.noiseAmplitude * 2)) - this.assumptions.noiseAmplitude;

        return Math.min(Math.max(synergy, 0.0), 1.0);
    }

    private simulateTrustPropagation(decision: Partial<DecisionObject>): number {
        // Trust propagates better if there's a clear delegation chain.
        const delegationLength = decision.authorityScope?.delegationChain?.length || 0;
        const baseTrust = this.assumptions.trustBase;

        let propagation = baseTrust + (delegationLength * 0.1);

        // High policy exposure levels reduce trust propagation.
        const totalExposure = decision.policyExposure?.reduce((acc, p) => acc + p.exposureLevel, 0) || 0;
        propagation -= (totalExposure * this.assumptions.trustPolicyExposurePenaltyWeight);

        return Math.min(Math.max(propagation, -1.0), 1.0);
    }

    private simulateIntelligenceEvolution(decision: Partial<DecisionObject>, synergy: number): number {
        // Cooperative intelligence evolves when synergy is high and stability is maintained.
        const stability = decision.projectedImpact?.systemStabilityScore ?? 0.5;

        let evolution =
            (synergy * this.assumptions.intelligenceSynergyWeight) +
            (stability * this.assumptions.intelligenceStabilityWeight);

        // If the action is a "WRITE" or "ADMIN" action, it has more potential to change 
        // the system's "intelligence" (state/policies), both positively and negatively.
        const isImpactfulPermission = decision.authorityScope?.permissions?.some(p =>
            ['WRITE', 'ADMIN', 'EXECUTE'].includes(p.toUpperCase())
        );

        if (isImpactfulPermission) {
            evolution *= this.assumptions.impactfulPermissionBoost;
        }

        return Math.min(Math.max(evolution, -1.0), 1.0);
    }

    private clampAssumption(key: keyof SimulationAssumptions, value: number): number {
        switch (key) {
            case 'noiseAmplitude':
                return this.clamp(value, 0, 0.3);
            case 'impactfulPermissionBoost':
                return this.clamp(value, 0.8, 1.8);
            default:
                return this.clamp(value, 0, 1.5);
        }
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }
}

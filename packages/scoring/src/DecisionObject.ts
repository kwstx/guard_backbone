import type { ComplianceForecast } from './ComplianceEstimator.js';
import type { StrategicAlignmentAssessment } from './StrategicAlignmentModule.js';
import type { OverrideRecord } from './HumanOverrideInterface.js';

/**
 * Represents the standardized input for risk-weighted scoring.
 * Encapsulates all relevant metadata for evaluating a proposed agent action.
 */
export interface DecisionObject {
    id: string;
    timestamp: Date;
    actionType: string;

    /** The agent's stated goal for this action */
    intent: string;

    /** The anticipated result if the action is successful */
    expectedOutcome: string;

    /** Resources required (CPU, API tokens, sensitive data access, budget, etc.) */
    requiredResources: {
        type: string;
        amount: number;
        unit: string;
        criticality: 'LOW' | 'MEDIUM' | 'HIGH';
    }[];

    /** The breadth of power required (e.g., READ / WRITE permissions, architectural layer) */
    authorityScope: {
        layer: string;
        permissions: string[];
        delegationChain?: string[];
    };

    /** Identification of policies affected by this action */
    policyExposure: {
        policyId: string;
        exposureLevel: number; // 0.0 to 1.0
        potentialViolations: string[];
    }[];

    /** Analysis of downstream effects on other modules or system state */
    projectedImpact: {
        systemStabilityScore: number; // -1.0 (damaging) to 1.0 (improving)
        trustWeightedPropagation: number;
        estimatedRecoveryTimeSeconds: number;

        // Extended Simulation Metrics
        realWorldTaskImpact: number; // -1.0 to 1.0
        predictiveSynergyDensity: number; // 0.0 to 1.0
        cooperativeIntelligenceEvolution: number; // -1.0 to 1.0
    };

    /** Probabilistic compliance forecast across the action lifecycle */
    complianceForecast?: ComplianceForecast;

    /** Strategic alignment assessment against organizational goals, initiatives, and cooperative objectives */
    strategicAlignment?: StrategicAlignmentAssessment;

    /** Per-action resource and economic analysis used by risk scoring */
    resourceAnalysis: {
        computationalCostScore: number; // 0.0 to 1.0
        estimatedFinancialExpenditureUSD: number;
        bandwidthUtilizationMbps: number;
        opportunityTradeoffScore: number; // 0.0 to 1.0
        projectedOpportunityCostOfBlockingUSD: number;
        economicEfficiencyScore: number; // 0.0 to 1.0
    };

    /** Human override record, populated when a stakeholder approves, rejects, or escalates this decision */
    humanOverride?: OverrideRecord;

    /** Metadata regarding the source agent */
    metadata: {
        agentId: string;
        agentType: string;
        contextId: string;
    };
}


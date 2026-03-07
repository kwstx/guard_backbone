import type { DecisionObject } from './DecisionObject.js';
import type { RiskScoreResult } from './RiskScoringEngine.js';
import type { ClassificationResult } from './ClassificationEngine.js';
import { RiskScoringEngine } from './RiskScoringEngine.js';
import { ClassificationEngine } from './ClassificationEngine.js';
import { v4 as uuidv4 } from 'uuid';

// ─── Stakeholder & Authorization ─────────────────────────────────────────────

/**
 * Stakeholder clearance levels, ordered from lowest to highest authority.
 */
export type StakeholderClearance = 'OBSERVER' | 'REVIEWER' | 'APPROVER' | 'ADMIN';

/**
 * Represents an authorized stakeholder who can participate in override decisions.
 */
export interface Stakeholder {
    id: string;
    name: string;
    role: string;
    department: string;
    clearance: StakeholderClearance;
    /** Domain expertise areas used to match with decision context */
    expertiseDomains: string[];
    /** Whether the stakeholder is currently active and eligible to override */
    active: boolean;
}

// ─── Override Verdict ────────────────────────────────────────────────────────

export type OverrideVerdict = 'APPROVED' | 'REJECTED' | 'ESCALATED';

// ─── Contextual Annotation ───────────────────────────────────────────────────

export type AnnotationCategory =
    | 'POLICY_REFERENCE'
    | 'RISK_OBSERVATION'
    | 'HISTORICAL_PRECEDENT'
    | 'DOMAIN_CONTEXT'
    | 'MITIGATION_SUGGESTION'
    | 'COMPLIANCE_NOTE'
    | 'GENERAL';

/**
 * A structured annotation that a stakeholder can attach to an override decision.
 * These annotations enrich the audit trail and provide signal for threshold adaptation.
 */
export interface ContextualAnnotation {
    id: string;
    category: AnnotationCategory;
    /** Free-form text content of the annotation */
    content: string;
    /** Optional references to policies, documents, or prior decisions */
    references: string[];
    /** Stakeholder-estimated relevance of this annotation (0.0 to 1.0) */
    relevanceWeight: number;
    timestamp: Date;
}

// ─── Override Rationale ──────────────────────────────────────────────────────

/**
 * Structured rationale capturing WHY a stakeholder chose to approve, reject,
 * or escalate a flagged decision.
 */
export interface OverrideRationale {
    /** High-level summary of the override reasoning */
    summary: string;
    /**
     * How confident the stakeholder is in this override decision (0.0 to 1.0).
     * Low confidence signals suggest the system should weigh this feedback less
     * heavily during threshold adaptation.
     */
    confidenceLevel: number;
    /**
     * Which risk dimensions the stakeholder believes were over- or under-weighted
     * by the automated scoring. Positive values indicate "overweighted" (system
     * was too conservative), negative values indicate "underweighted" (system
     * missed real risk).
     */
    dimensionDisagreements: {
        dimension: string;
        stakeholderAssessment: number; // -1.0 (system under-scored) to 1.0 (system over-scored)
        justification: string;
    }[];
    /** Whether the stakeholder deems the risk acceptable despite system flags */
    riskAccepted: boolean;
    /** Optional conditions the stakeholder attaches to approval (e.g., "only during business hours") */
    conditionalRequirements: string[];
}

// ─── Override Record ─────────────────────────────────────────────────────────

/**
 * Immutable audit record of a human override decision.
 */
export interface OverrideRecord {
    id: string;
    decisionId: string;
    stakeholder: Stakeholder;
    verdict: OverrideVerdict;
    rationale: OverrideRationale;
    annotations: ContextualAnnotation[];
    /** The original classification state that was overridden */
    originalClassification: ClassificationResult;
    /** The risk score at the time of the override */
    riskScoreAtOverride: RiskScoreResult;
    /** Timestamp when the override was submitted */
    timestamp: Date;
    /** Time in milliseconds between flagging and the override decision */
    reviewDurationMs: number;
}

// ─── Override Request ────────────────────────────────────────────────────────

/**
 * Pending override request awaiting stakeholder action.
 */
export interface OverrideRequest {
    id: string;
    decision: DecisionObject;
    riskScore: RiskScoreResult;
    classification: ClassificationResult;
    /** When the request was created */
    flaggedAt: Date;
    /** Whether this request has been resolved */
    resolved: boolean;
    /** The resulting override record, populated once resolved */
    overrideRecord?: OverrideRecord;
}

// ─── Adaptation Signal ───────────────────────────────────────────────────────

/**
 * A structured signal derived from override patterns, fed into the
 * threshold adaptation engine for continuous refinement.
 */
export interface OverrideAdaptationSignal {
    /** Override approval rate across recent history */
    approvalRate: number;
    /** Override rejection rate across recent history */
    rejectionRate: number;
    /** Average stakeholder confidence across recent overrides */
    averageConfidence: number;
    /** Aggregated dimension disagreements weighted by confidence */
    weightedDimensionDisagreements: Record<string, number>;
    /** Total number of overrides in the analysis window */
    sampleSize: number;
    /** Average review duration across recent overrides (ms) */
    averageReviewDurationMs: number;
    /** Proportion of overrides with conditional requirements */
    conditionalApprovalRate: number;
}

// ─── Authorization Errors ────────────────────────────────────────────────────

export class InsufficientClearanceError extends Error {
    constructor(stakeholder: Stakeholder, requiredClearance: StakeholderClearance) {
        super(
            `Stakeholder "${stakeholder.name}" (clearance: ${stakeholder.clearance}) ` +
            `does not meet the required clearance level: ${requiredClearance}`
        );
        this.name = 'InsufficientClearanceError';
    }
}

export class StakeholderInactiveError extends Error {
    constructor(stakeholder: Stakeholder) {
        super(`Stakeholder "${stakeholder.name}" (ID: ${stakeholder.id}) is not currently active.`);
        this.name = 'StakeholderInactiveError';
    }
}

// ─── HumanOverrideInterface ──────────────────────────────────────────────────

/**
 * The HumanOverrideInterface enables authorized stakeholders to approve, reject,
 * or escalate flagged decisions. It captures structured rationale and contextual
 * annotations, maintains a full audit trail, and feeds override data into the
 * RiskScoringEngine and ClassificationEngine for continuous threshold refinement.
 *
 * Integration Points:
 * - RiskScoringEngine.updateCalibrationFromFeedback(): override verdicts translate
 *   into outcome observations that shift adaptive multipliers.
 * - ClassificationEngine.recordOutcome(): each override is recorded as a violation
 *   trend data point, influencing future threshold band positioning.
 */
export class HumanOverrideInterface {
    private readonly clearanceHierarchy: Record<StakeholderClearance, number> = {
        OBSERVER: 0,
        REVIEWER: 1,
        APPROVER: 2,
        ADMIN: 3,
    };

    /** Minimum clearance required to submit an override verdict */
    private readonly minimumOverrideClearance: StakeholderClearance = 'APPROVER';

    /** Minimum clearance required to escalate a decision */
    private readonly minimumEscalationClearance: StakeholderClearance = 'REVIEWER';

    /** Pending override requests indexed by request ID */
    private pendingRequests: Map<string, OverrideRequest> = new Map();

    /** Complete audit trail of all resolved overrides */
    private overrideHistory: OverrideRecord[] = [];

    /** Maximum override history window for adaptation signal calculation */
    private readonly adaptationWindowSize: number;

    /** Learning rate applied when feeding override data into the scoring engine */
    private readonly overrideLearningRate: number;

    constructor(
        adaptationWindowSize: number = 100,
        overrideLearningRate: number = 0.04
    ) {
        this.adaptationWindowSize = Math.max(10, adaptationWindowSize);
        this.overrideLearningRate = Math.max(0.005, Math.min(overrideLearningRate, 0.2));
    }

    // ── Request Management ───────────────────────────────────────────────────

    /**
     * Creates a pending override request for a flagged decision.
     * This is called when the ClassificationEngine classifies a decision as 'flag-for-review'.
     */
    public createOverrideRequest(
        decision: DecisionObject,
        riskScore: RiskScoreResult,
        classification: ClassificationResult
    ): OverrideRequest {
        const request: OverrideRequest = {
            id: uuidv4(),
            decision,
            riskScore,
            classification,
            flaggedAt: new Date(),
            resolved: false,
        };

        this.pendingRequests.set(request.id, request);
        console.log(`[HumanOverrideInterface] Override request ${request.id} created for decision ${decision.id}`);
        return request;
    }

    /**
     * Returns all pending (unresolved) override requests.
     */
    public getPendingRequests(): OverrideRequest[] {
        return Array.from(this.pendingRequests.values()).filter(r => !r.resolved);
    }

    /**
     * Returns a specific override request by ID, or undefined if not found.
     */
    public getRequest(requestId: string): OverrideRequest | undefined {
        return this.pendingRequests.get(requestId);
    }

    // ── Authorization ────────────────────────────────────────────────────────

    /**
     * Verifies that a stakeholder meets the clearance requirements for a given action.
     * Throws InsufficientClearanceError or StakeholderInactiveError on failure.
     */
    public authorizeStakeholder(
        stakeholder: Stakeholder,
        requiredClearance: StakeholderClearance
    ): void {
        if (!stakeholder.active) {
            throw new StakeholderInactiveError(stakeholder);
        }

        if (this.clearanceHierarchy[stakeholder.clearance] < this.clearanceHierarchy[requiredClearance]) {
            throw new InsufficientClearanceError(stakeholder, requiredClearance);
        }
    }

    // ── Override Submission ──────────────────────────────────────────────────

    /**
     * Submits a human override verdict for a pending request.
     *
     * This method:
     * 1. Validates stakeholder authorization.
     * 2. Creates an immutable OverrideRecord with the verdict, rationale, and annotations.
     * 3. Feeds the override signal into the RiskScoringEngine for adaptive recalibration.
     * 4. Records the override outcome in the ClassificationEngine's violation history.
     * 5. Appends the record to the audit trail.
     *
     * @returns The completed OverrideRecord
     */
    public submitOverride(
        requestId: string,
        stakeholder: Stakeholder,
        verdict: OverrideVerdict,
        rationale: OverrideRationale,
        annotations: ContextualAnnotation[],
        scoringEngine: RiskScoringEngine,
        classificationEngine: ClassificationEngine
    ): OverrideRecord {
        // 1. Retrieve the pending request
        const request = this.pendingRequests.get(requestId);
        if (!request) {
            throw new Error(`Override request "${requestId}" not found.`);
        }
        if (request.resolved) {
            throw new Error(`Override request "${requestId}" has already been resolved.`);
        }

        // 2. Authorize the stakeholder
        const requiredClearance = verdict === 'ESCALATED'
            ? this.minimumEscalationClearance
            : this.minimumOverrideClearance;
        this.authorizeStakeholder(stakeholder, requiredClearance);

        // 3. Stamp and finalize annotations
        const stampedAnnotations = annotations.map(a => ({
            ...a,
            id: a.id || uuidv4(),
            timestamp: a.timestamp || new Date(),
            relevanceWeight: Math.max(0, Math.min(1, a.relevanceWeight)),
        }));

        // 4. Calculate review duration
        const reviewDurationMs = Date.now() - request.flaggedAt.getTime();

        // 5. Create the override record
        const record: OverrideRecord = {
            id: uuidv4(),
            decisionId: request.decision.id,
            stakeholder,
            verdict,
            rationale: {
                ...rationale,
                confidenceLevel: Math.max(0, Math.min(1, rationale.confidenceLevel)),
            },
            annotations: stampedAnnotations,
            originalClassification: request.classification,
            riskScoreAtOverride: request.riskScore,
            timestamp: new Date(),
            reviewDurationMs,
        };

        // 6. Mark request resolved
        request.resolved = true;
        request.overrideRecord = record;

        // 7. Feed data into the threshold adaptation engine
        this.feedIntoScoringEngine(record, request.riskScore, scoringEngine);
        this.feedIntoClassificationEngine(record, classificationEngine);

        // 8. Append to audit trail
        this.overrideHistory.push(record);
        if (this.overrideHistory.length > this.adaptationWindowSize * 3) {
            // Keep a generous buffer but prevent unbounded growth
            this.overrideHistory = this.overrideHistory.slice(-this.adaptationWindowSize * 2);
        }

        console.log(
            `[HumanOverrideInterface] Override ${record.id} submitted by "${stakeholder.name}" ` +
            `| Verdict: ${verdict} | Decision: ${record.decisionId} | ` +
            `Confidence: ${(record.rationale.confidenceLevel * 100).toFixed(1)}% | ` +
            `Review Time: ${(reviewDurationMs / 1000).toFixed(1)}s`
        );

        return record;
    }

    // ── Annotation Helpers ───────────────────────────────────────────────────

    /**
     * Creates a structured contextual annotation.
     */
    public createAnnotation(
        category: AnnotationCategory,
        content: string,
        references: string[] = [],
        relevanceWeight: number = 0.5
    ): ContextualAnnotation {
        return {
            id: uuidv4(),
            category,
            content,
            references,
            relevanceWeight: Math.max(0, Math.min(1, relevanceWeight)),
            timestamp: new Date(),
        };
    }

    // ── Threshold Adaptation Feed ────────────────────────────────────────────

    /**
     * Translates an override record into a calibration feedback signal for the
     * RiskScoringEngine. The override verdict and dimension disagreements are
     * converted into an "observed outcome" to drive adaptive multiplier shifts.
     *
     * Logic:
     * - APPROVED overrides imply the system was too conservative -> the observed
     *   compliance is high, stability was fine, no cost overrun.
     * - REJECTED overrides confirm system flags were correct or insufficient ->
     *   the observed compliance is lower, stability risk exists.
     * - ESCALATED overrides are treated as mild signals toward tightening.
     * - Stakeholder confidence modulates the learning rate.
     */
    private feedIntoScoringEngine(
        record: OverrideRecord,
        predicted: RiskScoreResult,
        scoringEngine: RiskScoringEngine
    ): void {
        const confidence = record.rationale.confidenceLevel;
        const modulatedLearningRate = this.overrideLearningRate * confidence;

        let complianceObserved: number;
        let stabilityIncidentOccurred: boolean;
        let costOverrunRatio: number;

        switch (record.verdict) {
            case 'APPROVED':
                // Stakeholder believes action is safe: push compliance signal higher
                complianceObserved = 0.85 + (confidence * 0.15); // 0.85–1.0
                stabilityIncidentOccurred = false;
                costOverrunRatio = 0.6; // Under budget expectations
                break;

            case 'REJECTED':
                // Stakeholder confirms risk: push compliance signal lower
                complianceObserved = 0.2 + ((1 - confidence) * 0.3); // 0.2–0.5
                stabilityIncidentOccurred = confidence > 0.7; // High-confidence rejections imply real risk
                costOverrunRatio = 1.2 + (confidence * 0.5); // 1.2–1.7
                break;

            case 'ESCALATED':
                // Uncertain: mild tightening signal
                complianceObserved = 0.55;
                stabilityIncidentOccurred = false;
                costOverrunRatio = 1.05;
                break;
        }

        scoringEngine.updateCalibrationFromFeedback(
            predicted,
            {
                complianceObserved,
                stabilityIncidentOccurred,
                costOverrunRatio,
            },
            modulatedLearningRate
        );

        console.log(
            `[HumanOverrideInterface → RiskScoringEngine] Fed calibration feedback: ` +
            `compliance=${complianceObserved.toFixed(3)}, ` +
            `stability=${stabilityIncidentOccurred}, ` +
            `costOverrun=${costOverrunRatio.toFixed(3)}, ` +
            `lr=${modulatedLearningRate.toFixed(4)}`
        );
    }

    /**
     * Feeds override outcomes into the ClassificationEngine's violation history.
     *
     * - REJECTED overrides are recorded as violations (the system correctly flagged
     *   the action, or should have blocked it outright).
     * - APPROVED overrides are recorded as non-violations (the system was too strict,
     *   which relaxes future threshold positioning).
     * - ESCALATED overrides are treated as mild violations to bias toward caution.
     */
    private feedIntoClassificationEngine(
        record: OverrideRecord,
        classificationEngine: ClassificationEngine
    ): void {
        let violated: boolean;
        let severity: number;

        switch (record.verdict) {
            case 'APPROVED':
                // System over-flagged — record as non-violation to relax thresholds
                violated = false;
                severity = 0;
                break;

            case 'REJECTED':
                // System correctly flagged or under-flagged — record as violation
                violated = true;
                severity = 0.4 + (record.rationale.confidenceLevel * 0.5); // 0.4–0.9
                break;

            case 'ESCALATED':
                // Ambiguous — record as mild violation to bias toward vigilance
                violated = true;
                severity = 0.2;
                break;
        }

        classificationEngine.recordOutcome({ violated, severity });

        console.log(
            `[HumanOverrideInterface → ClassificationEngine] Recorded outcome: ` +
            `violated=${violated}, severity=${severity.toFixed(3)}`
        );
    }

    // ── Audit & Analytics ────────────────────────────────────────────────────

    /**
     * Returns the full audit trail of override records.
     */
    public getOverrideHistory(): OverrideRecord[] {
        return [...this.overrideHistory];
    }

    /**
     * Returns override records for a specific decision.
     */
    public getOverridesForDecision(decisionId: string): OverrideRecord[] {
        return this.overrideHistory.filter(r => r.decisionId === decisionId);
    }

    /**
     * Computes an aggregated OverrideAdaptationSignal from recent override history.
     * This signal can be consumed by external threshold adaptation engines for
     * higher-order policy refinement beyond the per-override feedback loop.
     */
    public computeAdaptationSignal(): OverrideAdaptationSignal {
        const window = this.overrideHistory.slice(-this.adaptationWindowSize);
        const sampleSize = window.length;

        if (sampleSize === 0) {
            return {
                approvalRate: 0,
                rejectionRate: 0,
                averageConfidence: 0,
                weightedDimensionDisagreements: {},
                sampleSize: 0,
                averageReviewDurationMs: 0,
                conditionalApprovalRate: 0,
            };
        }

        const approvals = window.filter(r => r.verdict === 'APPROVED').length;
        const rejections = window.filter(r => r.verdict === 'REJECTED').length;

        const totalConfidence = window.reduce(
            (sum, r) => sum + r.rationale.confidenceLevel, 0
        );
        const totalReviewDuration = window.reduce(
            (sum, r) => sum + r.reviewDurationMs, 0
        );
        const conditionalApprovals = window.filter(
            r => r.verdict === 'APPROVED' && r.rationale.conditionalRequirements.length > 0
        ).length;

        // Aggregate dimension disagreements, weighted by stakeholder confidence
        const disagreements: Record<string, { weightedSum: number; totalWeight: number }> = {};
        for (const record of window) {
            const confidence = record.rationale.confidenceLevel;
            for (const d of record.rationale.dimensionDisagreements) {
                if (!disagreements[d.dimension]) {
                    disagreements[d.dimension] = { weightedSum: 0, totalWeight: 0 };
                }
                disagreements[d.dimension].weightedSum += d.stakeholderAssessment * confidence;
                disagreements[d.dimension].totalWeight += confidence;
            }
        }

        const weightedDimensionDisagreements: Record<string, number> = {};
        for (const [dimension, data] of Object.entries(disagreements)) {
            weightedDimensionDisagreements[dimension] =
                data.totalWeight > 0
                    ? Number((data.weightedSum / data.totalWeight).toFixed(4))
                    : 0;
        }

        return {
            approvalRate: Number((approvals / sampleSize).toFixed(4)),
            rejectionRate: Number((rejections / sampleSize).toFixed(4)),
            averageConfidence: Number((totalConfidence / sampleSize).toFixed(4)),
            weightedDimensionDisagreements,
            sampleSize,
            averageReviewDurationMs: Number((totalReviewDuration / sampleSize).toFixed(2)),
            conditionalApprovalRate: approvals > 0
                ? Number((conditionalApprovals / approvals).toFixed(4))
                : 0,
        };
    }

    /**
     * Returns the total count of overrides by verdict type.
     */
    public getVerdictDistribution(): Record<OverrideVerdict, number> {
        const dist: Record<OverrideVerdict, number> = {
            APPROVED: 0,
            REJECTED: 0,
            ESCALATED: 0,
        };

        for (const record of this.overrideHistory) {
            dist[record.verdict]++;
        }

        return dist;
    }
}

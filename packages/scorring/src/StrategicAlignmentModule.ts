import type { DecisionObject } from './DecisionObject.js';

// ---------------------------------------------------------------------------
// Strategic Domain Types
// ---------------------------------------------------------------------------

/**
 * A declared organizational goal representing a strategic direction.
 * Goals carry weight, a time horizon, and keyword indicators used
 * for semantic matching against proposed actions.
 */
export interface OrganizationalGoal {
    id: string;
    title: string;
    description: string;
    /** Strategic priority weight from 0.0 (negligible) to 1.0 (critical). */
    priority: number;
    /** Keywords and phrases that signal alignment with this goal. */
    alignmentIndicators: string[];
    /** Keywords and phrases that signal misalignment with this goal. */
    misalignmentIndicators: string[];
    /** Time horizon for this goal. */
    horizon: 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';
    /** Functional domains this goal covers. */
    domains: string[];
}

/**
 * An active organizational initiative — a concrete program of work
 * that realizes one or more strategic goals.
 */
export interface ActiveInitiative {
    id: string;
    name: string;
    description: string;
    /** IDs of the organizational goals this initiative serves. */
    linkedGoalIds: string[];
    /** Current lifecycle status. */
    status: 'PLANNING' | 'IN_PROGRESS' | 'SCALING' | 'WINDING_DOWN';
    /** Resource domains that this initiative consumes / protects. */
    resourceDomains: string[];
    /** Keywords whose presence in an action signal synergy with this initiative. */
    synergyIndicators: string[];
    /** Keywords whose presence in an action signal conflict with this initiative. */
    conflictIndicators: string[];
    /** Weight reflecting the initiative's current organizational importance (0..1). */
    importanceWeight: number;
}

/**
 * A long-term cooperative impact objective describing outcomes the
 * organization seeks in the broader ecosystem (partner trust, ecosystem
 * growth, shared infrastructure resilience, etc.).
 */
export interface CooperativeImpactObjective {
    id: string;
    title: string;
    description: string;
    /** Ecosystem dimensions this objective covers. */
    impactDimensions: string[];
    /** Keywords signaling positive contribution. */
    positiveSignals: string[];
    /** Keywords signaling erosion of the objective. */
    erosionSignals: string[];
    /** Weight for this objective (0..1). */
    weight: number;
}

// ---------------------------------------------------------------------------
// Module Output Types
// ---------------------------------------------------------------------------

/**
 * Per-goal alignment detail produced during evaluation.
 */
export interface GoalAlignmentDetail {
    goalId: string;
    goalTitle: string;
    alignmentScore: number; // -1.0 (actively undermining) to 1.0 (strongly aligned)
    matchedAlignmentIndicators: string[];
    matchedMisalignmentIndicators: string[];
    contribution: 'STRONGLY_ALIGNED' | 'ALIGNED' | 'NEUTRAL' | 'MISALIGNED' | 'STRONGLY_MISALIGNED';
}

/**
 * Per-initiative alignment detail assessing synergy or conflict.
 */
export interface InitiativeAlignmentDetail {
    initiativeId: string;
    initiativeName: string;
    synergyScore: number; // -1.0 to 1.0
    matchedSynergyIndicators: string[];
    matchedConflictIndicators: string[];
    resourceConflict: boolean;
    statusInterference: boolean;
}

/**
 * Per-objective alignment detail for cooperative impact.
 */
export interface CooperativeImpactDetail {
    objectiveId: string;
    objectiveTitle: string;
    impactScore: number; // -1.0 (erosion) to 1.0 (strengthening)
    matchedPositiveSignals: string[];
    matchedErosionSignals: string[];
}

/**
 * Consolidated strategic alignment assessment attached to a DecisionObject.
 */
export interface StrategicAlignmentAssessment {
    /** Composite alignment score from 0.0 (total misalignment) to 1.0 (perfect alignment). */
    overallAlignmentScore: number;
    /** Strategic misalignment penalty applied to risk scoring (0.0 = none, 1.0 = maximum). */
    misalignmentPenalty: number;
    /** Per-goal breakdown. */
    goalAlignments: GoalAlignmentDetail[];
    /** Per-initiative breakdown. */
    initiativeAlignments: InitiativeAlignmentDetail[];
    /** Per-objective breakdown. */
    cooperativeImpactAlignments: CooperativeImpactDetail[];
    /** Human-readable summary of the most significant alignment issues. */
    alignmentFlags: string[];
    /** Timestamp of evaluation. */
    evaluatedAt: Date;
}

// ---------------------------------------------------------------------------
// StrategicAlignmentModule
// ---------------------------------------------------------------------------

/**
 * StrategicAlignmentModule compares proposed actions against declared
 * organizational goals, active initiatives, and long-term cooperative
 * impact objectives. It produces a StrategicAlignmentAssessment that
 * quantifies how well an action supports or undermines strategic direction.
 *
 * Actions that are technically permitted but strategically misaligned
 * receive a misalignment penalty that is fed into the RiskScoringEngine
 * as an additional risk dimension.
 */
export class StrategicAlignmentModule {
    private goals: OrganizationalGoal[] = [];
    private initiatives: ActiveInitiative[] = [];
    private cooperativeObjectives: CooperativeImpactObjective[] = [];

    constructor() {
        this.loadDefaultStrategicContext();
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Evaluates a DecisionObject against the full strategic context and returns
     * a structured alignment assessment.
     */
    public evaluate(decision: DecisionObject): StrategicAlignmentAssessment {
        const actionText = this.buildActionTextCorpus(decision);

        // 1. Evaluate against organizational goals
        const goalAlignments = this.evaluateGoalAlignment(actionText, decision);

        // 2. Evaluate against active initiatives
        const initiativeAlignments = this.evaluateInitiativeAlignment(actionText, decision);

        // 3. Evaluate against cooperative impact objectives
        const cooperativeImpactAlignments = this.evaluateCooperativeImpactAlignment(actionText, decision);

        // 4. Compute composite alignment score
        const overallAlignmentScore = this.computeOverallAlignment(
            goalAlignments,
            initiativeAlignments,
            cooperativeImpactAlignments
        );

        // 5. Derive the misalignment penalty for the risk engine
        const misalignmentPenalty = this.computeMisalignmentPenalty(
            overallAlignmentScore,
            goalAlignments,
            initiativeAlignments,
            cooperativeImpactAlignments
        );

        // 6. Collect human-readable alignment flags
        const alignmentFlags = this.collectAlignmentFlags(
            goalAlignments,
            initiativeAlignments,
            cooperativeImpactAlignments
        );

        return {
            overallAlignmentScore: Number(overallAlignmentScore.toFixed(4)),
            misalignmentPenalty: Number(misalignmentPenalty.toFixed(4)),
            goalAlignments,
            initiativeAlignments,
            cooperativeImpactAlignments,
            alignmentFlags,
            evaluatedAt: new Date(),
        };
    }

    /** Register additional organizational goals at runtime. */
    public registerGoal(goal: OrganizationalGoal): void {
        this.goals.push(goal);
    }

    /** Register additional active initiatives at runtime. */
    public registerInitiative(initiative: ActiveInitiative): void {
        this.initiatives.push(initiative);
    }

    /** Register additional cooperative impact objectives at runtime. */
    public registerCooperativeObjective(objective: CooperativeImpactObjective): void {
        this.cooperativeObjectives.push(objective);
    }

    // ------------------------------------------------------------------
    // Goal Alignment
    // ------------------------------------------------------------------

    private evaluateGoalAlignment(
        actionText: string,
        decision: DecisionObject
    ): GoalAlignmentDetail[] {
        return this.goals.map((goal) => {
            const matchedAlignment = this.matchIndicators(actionText, goal.alignmentIndicators);
            const matchedMisalignment = this.matchIndicators(actionText, goal.misalignmentIndicators);

            // Domain overlap between the action's authority layer and the goal's domains
            const domainOverlap = goal.domains.some((domain) =>
                actionText.includes(domain.toLowerCase())
            )
                ? 0.15
                : 0;

            // Base alignment signal: positive from alignment hits, negative from misalignment hits
            const alignmentSignal =
                matchedAlignment.length * 0.25 - matchedMisalignment.length * 0.35;

            // Horizon multiplier — misalignment with long-term goals is heavier
            const horizonMultiplier =
                goal.horizon === 'LONG_TERM' ? 1.3 : goal.horizon === 'MEDIUM_TERM' ? 1.0 : 0.8;

            // Raw alignment score before clamping
            const rawScore = (alignmentSignal + domainOverlap) * horizonMultiplier * goal.priority;
            const alignmentScore = Number(this.clamp(rawScore, -1, 1).toFixed(4));

            const contribution: GoalAlignmentDetail['contribution'] =
                alignmentScore >= 0.5
                    ? 'STRONGLY_ALIGNED'
                    : alignmentScore >= 0.15
                        ? 'ALIGNED'
                        : alignmentScore > -0.15
                            ? 'NEUTRAL'
                            : alignmentScore > -0.5
                                ? 'MISALIGNED'
                                : 'STRONGLY_MISALIGNED';

            return {
                goalId: goal.id,
                goalTitle: goal.title,
                alignmentScore,
                matchedAlignmentIndicators: matchedAlignment,
                matchedMisalignmentIndicators: matchedMisalignment,
                contribution,
            };
        });
    }

    // ------------------------------------------------------------------
    // Initiative Alignment
    // ------------------------------------------------------------------

    private evaluateInitiativeAlignment(
        actionText: string,
        decision: DecisionObject
    ): InitiativeAlignmentDetail[] {
        return this.initiatives.map((initiative) => {
            const matchedSynergy = this.matchIndicators(actionText, initiative.synergyIndicators);
            const matchedConflict = this.matchIndicators(actionText, initiative.conflictIndicators);

            // Check resource domain overlap (potential contention)
            const actionResources = decision.requiredResources.map((r) => r.type.toLowerCase());
            const resourceConflict = initiative.resourceDomains.some((domain) =>
                actionResources.includes(domain.toLowerCase())
            );

            // Status interference: winding-down initiatives should not receive new resource load
            const statusInterference =
                initiative.status === 'WINDING_DOWN' &&
                matchedSynergy.length === 0 &&
                resourceConflict;

            // Synergy score
            let synergySignal =
                matchedSynergy.length * 0.3 - matchedConflict.length * 0.4;

            // Resource conflict dampens synergy
            if (resourceConflict && matchedSynergy.length === 0) {
                synergySignal -= 0.2;
            }

            // Status-based modulation
            if (initiative.status === 'SCALING') {
                // Active scaling initiatives are sensitive to conflict
                synergySignal *= 1.15;
            } else if (initiative.status === 'WINDING_DOWN') {
                // Winding-down initiatives should not be re-invested in; conflict matters less
                synergySignal *= 0.7;
            }

            const synergyScore = Number(
                this.clamp(synergySignal * initiative.importanceWeight, -1, 1).toFixed(4)
            );

            return {
                initiativeId: initiative.id,
                initiativeName: initiative.name,
                synergyScore,
                matchedSynergyIndicators: matchedSynergy,
                matchedConflictIndicators: matchedConflict,
                resourceConflict,
                statusInterference,
            };
        });
    }

    // ------------------------------------------------------------------
    // Cooperative Impact Alignment
    // ------------------------------------------------------------------

    private evaluateCooperativeImpactAlignment(
        actionText: string,
        decision: DecisionObject
    ): CooperativeImpactDetail[] {
        return this.cooperativeObjectives.map((objective) => {
            const matchedPositive = this.matchIndicators(actionText, objective.positiveSignals);
            const matchedErosion = this.matchIndicators(actionText, objective.erosionSignals);

            // Incorporate the decision's cooperative metrics if available
            const coopEvolution = decision.projectedImpact.cooperativeIntelligenceEvolution;
            const synergyDensity = decision.projectedImpact.predictiveSynergyDensity;

            let impactSignal =
                matchedPositive.length * 0.3 - matchedErosion.length * 0.4;

            // Amplify signal using projected cooperative metrics
            const cooperativeBoost = (coopEvolution + synergyDensity) / 4; // Subtle amplifier
            impactSignal += cooperativeBoost;

            const impactScore = Number(
                this.clamp(impactSignal * objective.weight, -1, 1).toFixed(4)
            );

            return {
                objectiveId: objective.id,
                objectiveTitle: objective.title,
                impactScore,
                matchedPositiveSignals: matchedPositive,
                matchedErosionSignals: matchedErosion,
            };
        });
    }

    // ------------------------------------------------------------------
    // Composite Scoring
    // ------------------------------------------------------------------

    /**
     * Combines the three alignment pillars into a single 0..1 composite score.
     * Each pillar is weighted to reflect organizational priorities:
     *   Goals:          40%
     *   Initiatives:    35%
     *   Cooperative:    25%
     */
    private computeOverallAlignment(
        goalAlignments: GoalAlignmentDetail[],
        initiativeAlignments: InitiativeAlignmentDetail[],
        cooperativeAlignments: CooperativeImpactDetail[]
    ): number {
        const goalAvg = this.weightedAverage(
            goalAlignments.map((g) => g.alignmentScore),
            this.goals.map((g) => g.priority)
        );

        const initiativeAvg = this.weightedAverage(
            initiativeAlignments.map((i) => i.synergyScore),
            this.initiatives.map((i) => i.importanceWeight)
        );

        const cooperativeAvg = this.weightedAverage(
            cooperativeAlignments.map((c) => c.impactScore),
            this.cooperativeObjectives.map((c) => c.weight)
        );

        // Normalize from [-1, 1] into [0, 1]
        const normalizedGoal = (goalAvg + 1) / 2;
        const normalizedInitiative = (initiativeAvg + 1) / 2;
        const normalizedCooperative = (cooperativeAvg + 1) / 2;

        return this.clamp01(
            normalizedGoal * 0.4 + normalizedInitiative * 0.35 + normalizedCooperative * 0.25
        );
    }

    /**
     * Computes the misalignment penalty that feeds into the risk engine.
     * A score of 0 means no penalty (fully aligned); 1 means maximum penalty.
     *
     * The penalty amplifies when:
     *   - Multiple goals are actively misaligned
     *   - Resource conflicts exist with in-progress initiatives
     *   - Cooperative objectives are being eroded
     */
    private computeMisalignmentPenalty(
        overallAlignment: number,
        goalAlignments: GoalAlignmentDetail[],
        initiativeAlignments: InitiativeAlignmentDetail[],
        cooperativeAlignments: CooperativeImpactDetail[]
    ): number {
        // Base penalty is 1 - alignment (higher alignment → lower penalty)
        let penalty = 1 - overallAlignment;

        // Count active misalignment signals for amplification
        const misalignedGoals = goalAlignments.filter(
            (g) => g.contribution === 'MISALIGNED' || g.contribution === 'STRONGLY_MISALIGNED'
        );
        const conflictedInitiatives = initiativeAlignments.filter(
            (i) => i.synergyScore < -0.1 || i.resourceConflict || i.statusInterference
        );
        const erodedObjectives = cooperativeAlignments.filter((c) => c.impactScore < -0.1);

        // Multi-factor amplification
        if (misalignedGoals.length > 0) {
            const goalPenaltyBoost =
                misalignedGoals.reduce((sum, g) => sum + Math.abs(g.alignmentScore), 0) /
                misalignedGoals.length;
            penalty += goalPenaltyBoost * 0.15;
        }

        if (conflictedInitiatives.length > 0) {
            const initiativePenaltyBoost =
                conflictedInitiatives.reduce(
                    (sum, i) => sum + Math.abs(i.synergyScore) + (i.statusInterference ? 0.1 : 0),
                    0
                ) / conflictedInitiatives.length;
            penalty += initiativePenaltyBoost * 0.12;
        }

        if (erodedObjectives.length > 0) {
            const cooperativePenaltyBoost =
                erodedObjectives.reduce((sum, c) => sum + Math.abs(c.impactScore), 0) /
                erodedObjectives.length;
            penalty += cooperativePenaltyBoost * 0.1;
        }

        // Breadth penalty: misalignment across many pillars simultaneously is worse
        const misalignmentBreadth =
            (misalignedGoals.length > 0 ? 1 : 0) +
            (conflictedInitiatives.length > 0 ? 1 : 0) +
            (erodedObjectives.length > 0 ? 1 : 0);

        if (misalignmentBreadth >= 3) {
            penalty *= 1.2; // 20% amplification for cross-pillar misalignment
        } else if (misalignmentBreadth === 2) {
            penalty *= 1.1;
        }

        return this.clamp01(penalty);
    }

    // ------------------------------------------------------------------
    // Alignment Flags
    // ------------------------------------------------------------------

    private collectAlignmentFlags(
        goalAlignments: GoalAlignmentDetail[],
        initiativeAlignments: InitiativeAlignmentDetail[],
        cooperativeAlignments: CooperativeImpactDetail[]
    ): string[] {
        const flags: string[] = [];

        for (const goal of goalAlignments) {
            if (goal.contribution === 'STRONGLY_MISALIGNED') {
                flags.push(
                    `CRITICAL: Action strongly misaligned with goal "${goal.goalTitle}" (score: ${goal.alignmentScore})`
                );
            } else if (goal.contribution === 'MISALIGNED') {
                flags.push(
                    `WARNING: Action misaligned with goal "${goal.goalTitle}" (score: ${goal.alignmentScore})`
                );
            }
        }

        for (const init of initiativeAlignments) {
            if (init.statusInterference) {
                flags.push(
                    `WARNING: Action interferes with winding-down initiative "${init.initiativeName}"`
                );
            }
            if (init.resourceConflict && init.synergyScore < 0) {
                flags.push(
                    `CAUTION: Resource conflict detected with initiative "${init.initiativeName}"`
                );
            }
            if (init.matchedConflictIndicators.length > 0) {
                flags.push(
                    `WARNING: Action conflicts with initiative "${init.initiativeName}" — matched: [${init.matchedConflictIndicators.join(', ')}]`
                );
            }
        }

        for (const coop of cooperativeAlignments) {
            if (coop.impactScore < -0.3) {
                flags.push(
                    `CRITICAL: Action erodes cooperative objective "${coop.objectiveTitle}" (score: ${coop.impactScore})`
                );
            } else if (coop.impactScore < -0.1) {
                flags.push(
                    `WARNING: Action may undermine cooperative objective "${coop.objectiveTitle}" (score: ${coop.impactScore})`
                );
            }
        }

        return flags;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Builds a lowercased text corpus from all decision fields so that
     * keyword matching can be performed uniformly.
     */
    private buildActionTextCorpus(decision: DecisionObject): string {
        const parts: string[] = [
            decision.actionType,
            decision.intent,
            decision.expectedOutcome,
            decision.authorityScope.layer,
            ...decision.authorityScope.permissions,
            ...(decision.authorityScope.delegationChain ?? []),
            ...decision.policyExposure.flatMap((p) => p.potentialViolations),
            ...decision.requiredResources.map((r) => r.type),
            decision.metadata.agentType,
        ];

        return parts.join(' ').toLowerCase();
    }

    /**
     * Match a list of indicator keywords/phrases against an action text corpus.
     * Returns the list of matched indicators.
     */
    private matchIndicators(actionText: string, indicators: string[]): string[] {
        return indicators.filter((indicator) =>
            actionText.includes(indicator.toLowerCase())
        );
    }

    /**
     * Computes a weighted average of values using corresponding weights.
     * Returns 0.0 if no values are provided.
     */
    private weightedAverage(values: number[], weights: number[]): number {
        if (values.length === 0) return 0;
        let weightedSum = 0;
        let totalWeight = 0;
        for (let i = 0; i < values.length; i++) {
            const w = weights[i] ?? 1;
            weightedSum += values[i] * w;
            totalWeight += w;
        }
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    private clamp01(value: number): number {
        return Math.min(Math.max(value, 0), 1);
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }

    // ------------------------------------------------------------------
    // Default Strategic Context
    // ------------------------------------------------------------------

    /**
     * Seeds the module with a representative set of organizational goals,
     * active initiatives, and cooperative impact objectives.
     */
    private loadDefaultStrategicContext(): void {
        // ---- Organizational Goals ----
        this.goals = [
            {
                id: 'GOAL-001',
                title: 'Strengthen Data Governance',
                description:
                    'Ensure all data handling follows strict governance, access controls, and audit requirements.',
                priority: 0.95,
                alignmentIndicators: [
                    'audit', 'governance', 'compliance', 'access control',
                    'data protection', 'encryption', 'retention policy',
                ],
                misalignmentIndicators: [
                    'delete', 'bypass', 'override', 'skip validation',
                    'disable logging', 'remove audit',
                ],
                horizon: 'LONG_TERM',
                domains: ['data', 'security', 'compliance'],
            },
            {
                id: 'GOAL-002',
                title: 'Accelerate Platform Modernization',
                description:
                    'Drive migration from legacy systems to modern, cloud-native architectures.',
                priority: 0.85,
                alignmentIndicators: [
                    'migrate', 'modernize', 'cloud', 'containerize',
                    'microservice', 'deploy', 'automate', 'scale',
                ],
                misalignmentIndicators: [
                    'legacy', 'monolith', 'manual process', 'revert',
                    'rollback architecture',
                ],
                horizon: 'MEDIUM_TERM',
                domains: ['infrastructure', 'platform', 'engineering'],
            },
            {
                id: 'GOAL-003',
                title: 'Maximize Operational Resilience',
                description:
                    'Build systems that recover quickly from failure and maintain service under stress.',
                priority: 0.9,
                alignmentIndicators: [
                    'resilience', 'recovery', 'redundancy', 'failover',
                    'health check', 'monitoring', 'incident response',
                ],
                misalignmentIndicators: [
                    'single point of failure', 'remove redundancy',
                    'skip health check', 'disable monitoring',
                ],
                horizon: 'LONG_TERM',
                domains: ['operations', 'infrastructure', 'reliability'],
            },
            {
                id: 'GOAL-004',
                title: 'Reduce Operational Cost',
                description:
                    'Systematically reduce unnecessary operational expenditure while maintaining quality.',
                priority: 0.7,
                alignmentIndicators: [
                    'optimize', 'cost reduction', 'efficiency', 'cleanup',
                    'archive', 'right-size', 'consolidate',
                ],
                misalignmentIndicators: [
                    'over-provision', 'duplicate', 'untracked spend',
                    'expand without justification',
                ],
                horizon: 'SHORT_TERM',
                domains: ['finance', 'operations', 'infrastructure'],
            },
        ];

        // ---- Active Initiatives ----
        this.initiatives = [
            {
                id: 'INIT-001',
                name: 'Zero-Trust Security Rollout',
                description:
                    'Implementing zero-trust network architecture across all services with continuous identity verification.',
                linkedGoalIds: ['GOAL-001', 'GOAL-003'],
                status: 'IN_PROGRESS',
                resourceDomains: ['network_egress_mb', 'api_call', 'cpu'],
                synergyIndicators: [
                    'zero trust', 'identity verification', 'mTLS',
                    'access control', 'authentication', 'authorization',
                ],
                conflictIndicators: [
                    'disable auth', 'bypass security', 'open access',
                    'remove firewall', 'skip verification',
                ],
                importanceWeight: 0.9,
            },
            {
                id: 'INIT-002',
                name: 'Cloud Migration Phase III',
                description:
                    'Final phase of migrating core services to cloud-native infrastructure.',
                linkedGoalIds: ['GOAL-002'],
                status: 'SCALING',
                resourceDomains: ['cpu', 'network_egress_mb', 'storage_gb'],
                synergyIndicators: [
                    'cloud', 'containerize', 'kubernetes', 'deploy',
                    'migrate', 'terraform', 'infrastructure as code',
                ],
                conflictIndicators: [
                    'on-premise', 'legacy', 'physical server',
                    'revert migration', 'abandon cloud',
                ],
                importanceWeight: 0.85,
            },
            {
                id: 'INIT-003',
                name: 'Audit Trail Modernization',
                description:
                    'Upgrading audit trail systems to provide immutable, queryable records of all system operations.',
                linkedGoalIds: ['GOAL-001'],
                status: 'IN_PROGRESS',
                resourceDomains: ['storage_gb', 'api_call'],
                synergyIndicators: [
                    'audit', 'logging', 'trail', 'immutable record',
                    'event sourcing', 'traceability',
                ],
                conflictIndicators: [
                    'delete log', 'remove audit', 'disable logging',
                    'truncate history',
                ],
                importanceWeight: 0.8,
            },
        ];

        // ---- Cooperative Impact Objectives ----
        this.cooperativeObjectives = [
            {
                id: 'COOP-001',
                title: 'Ecosystem Trust Preservation',
                description:
                    'Maintain and strengthen trust across partner ecosystems through transparent, predictable behavior.',
                impactDimensions: ['trust', 'transparency', 'partner relations'],
                positiveSignals: [
                    'transparency', 'partner', 'trust', 'collaboration',
                    'shared standard', 'open protocol',
                ],
                erosionSignals: [
                    'unilateral', 'opaque', 'hidden', 'bypass partner',
                    'break contract', 'violate sla',
                ],
                weight: 0.85,
            },
            {
                id: 'COOP-002',
                title: 'Shared Infrastructure Resilience',
                description:
                    'Contribute to the resilience of shared infrastructure and common platforms used by the broader ecosystem.',
                impactDimensions: ['infrastructure', 'resilience', 'shared services'],
                positiveSignals: [
                    'shared infrastructure', 'common platform', 'resilience',
                    'redundancy', 'disaster recovery', 'cross-system',
                ],
                erosionSignals: [
                    'degrade shared', 'overload common', 'exhaust shared',
                    'monopolize resource', 'destabilize platform',
                ],
                weight: 0.8,
            },
            {
                id: 'COOP-003',
                title: 'Long-Term Cooperative Intelligence Growth',
                description:
                    'Foster conditions for continuous improvement in cooperative decision-making across agents and organizations.',
                impactDimensions: ['intelligence', 'learning', 'cooperative evolution'],
                positiveSignals: [
                    'learning', 'adaptation', 'feedback loop', 'cooperative',
                    'collective intelligence', 'knowledge sharing',
                ],
                erosionSignals: [
                    'suppress learning', 'isolate', 'hoard knowledge',
                    'prevent adaptation', 'block feedback',
                ],
                weight: 0.75,
            },
        ];
    }
}

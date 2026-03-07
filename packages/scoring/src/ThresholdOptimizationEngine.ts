import type { RiskDimension, RiskScoreResult } from './RiskScoringEngine.js';
import type { ClassificationResult, ThresholdBand } from './ClassificationEngine.js';
import type { OverrideRecord, OverrideAdaptationSignal } from './HumanOverrideInterface.js';
import { RiskScoringEngine } from './RiskScoringEngine.js';
import { ClassificationEngine } from './ClassificationEngine.js';
import { v4 as uuidv4 } from 'uuid';

// ─── Reinforcement Signal Types ──────────────────────────────────────────────

/**
 * Describes the type of reinforcement event that drives threshold recalibration.
 *
 *  - REAL_OUTCOME:      Post-execution observation of what actually happened.
 *  - HUMAN_OVERRIDE:    A stakeholder approved, rejected, or escalated a flagged decision.
 *  - FALSE_POSITIVE:    System blocked or flagged an action that turned out to be safe.
 *  - MISSED_VIOLATION:  System approved an action that later proved to be a violation.
 */
export type ReinforcementSignalType =
    | 'REAL_OUTCOME'
    | 'HUMAN_OVERRIDE'
    | 'FALSE_POSITIVE'
    | 'MISSED_VIOLATION';

/**
 * A structured reinforcement event ingested by the optimization engine.
 */
export interface ReinforcementSignal {
    id: string;
    type: ReinforcementSignalType;
    timestamp: Date;

    /** The decision ID this signal relates to */
    decisionId: string;

    /** Original risk score at the time the decision was evaluated */
    originalRiskScore: RiskScoreResult;

    /** Original classification at the time the decision was evaluated */
    originalClassification: ClassificationResult;

    /** For REAL_OUTCOME: observed compliance (0.0–1.0) */
    observedCompliance?: number;

    /** For REAL_OUTCOME: whether a stability incident occurred */
    stabilityIncident?: boolean;

    /** For REAL_OUTCOME: actual cost relative to estimate (1.0 = on budget, >1 = overrun) */
    costRatio?: number;

    /** For HUMAN_OVERRIDE: the full override record */
    overrideRecord?: OverrideRecord;

    /** For FALSE_POSITIVE: which dimension(s) were over-penalized */
    overPenalizedDimensions?: RiskDimension[];

    /** For MISSED_VIOLATION: which dimension(s) failed to detect the threat */
    missedDimensions?: RiskDimension[];

    /** For MISSED_VIOLATION: severity of the missed violation (0.0–1.0) */
    missedSeverity?: number;

    /** Stakeholder confidence or evidence quality (0.0–1.0). Modulates learning rate. */
    signalConfidence: number;
}

// ─── Threshold Version Snapshot ──────────────────────────────────────────────

/**
 * A complete, immutable snapshot of the engine's threshold configuration
 * at a specific point in time. Enables rollback and historical audit.
 */
export interface ThresholdVersion {
    /** Unique version identifier */
    versionId: string;

    /** Sequential version number (monotonically increasing) */
    versionNumber: number;

    /** When this version was created */
    createdAt: Date;

    /** Human-readable reason for the version change */
    changeReason: string;

    /** IDs of signals that motivated this version */
    triggeringSignalIds: string[];

    /** Snapshot of the classification threshold band */
    thresholdBand: ThresholdBand;

    /** Snapshot of risk dimension adaptive multipliers */
    adaptiveMultipliers: Record<RiskDimension, number>;

    /** Per-dimension sensitivity adjustments applied by this engine */
    dimensionSensitivity: Record<RiskDimension, number>;

    /** Overall conservatism bias (-1 = relaxed, 0 = neutral, 1 = strict) */
    conservatismBias: number;

    /** Whether this version is the currently active one */
    active: boolean;
}

// ─── Optimization Report ─────────────────────────────────────────────────────

/**
 * Summary of an optimization cycle's outcome.
 */
export interface OptimizationReport {
    /** The newly created threshold version */
    newVersion: ThresholdVersion;

    /** The version that was active before this cycle */
    previousVersion: ThresholdVersion | null;

    /** Number of signals processed in this cycle */
    signalsProcessed: number;

    /** Signal type breakdown */
    signalTypeCounts: Record<ReinforcementSignalType, number>;

    /** Per-dimension adjustment deltas applied */
    appliedDimensionDeltas: Partial<Record<RiskDimension, number>>;

    /** Threshold band shift */
    thresholdBandShift: {
        autoApproveMinDelta: number;
        blockMaxDelta: number;
    };

    /** Conservatism bias change */
    conservatismBiasDelta: number;

    /** Effective learning rate after modulation */
    effectiveLearningRate: number;

    /** Whether the adaptation was dampened by safety constraints */
    dampened: boolean;
}

// ─── Rollback Result ─────────────────────────────────────────────────────────

export interface RollbackResult {
    success: boolean;
    rolledBackFrom: ThresholdVersion;
    rolledBackTo: ThresholdVersion;
    reason: string;
}

// ─── Engine Configuration ────────────────────────────────────────────────────

export interface ThresholdOptimizationConfig {
    /** Base learning rate for threshold adjustments (default: 0.08) */
    baseLearningRate?: number;

    /** Maximum allowed shift per optimization cycle (default: 5.0 score points) */
    maxShiftPerCycle?: number;

    /** Minimum signals required before an optimization cycle triggers (default: 3) */
    minimumSignalCount?: number;

    /** Maximum version history depth (default: 100) */
    maxVersionHistory?: number;

    /** Exponential decay factor for older signals (default: 0.92) */
    signalDecayFactor?: number;

    /** Minimum learning rate floor (default: 0.005) */
    minimumLearningRate?: number;

    /** Maximum learning rate ceiling (default: 0.25) */
    maximumLearningRate?: number;

    /** Conservatism bias clamp range (default: [-0.6, 0.6]) */
    conservatismBiasRange?: [number, number];

    /** Dimension sensitivity clamp range (default: [0.4, 2.0]) */
    dimensionSensitivityRange?: [number, number];
}

// ─── ThresholdOptimizationEngine ─────────────────────────────────────────────

/**
 * The ThresholdOptimizationEngine recalibrates risk boundaries using
 * reinforcement signals from real outcomes, human overrides, false positives,
 * and missed violations. Every adjustment is:
 *
 *  - **Gradual**: bounded learning rates and per-cycle shift caps prevent drastic swings.
 *  - **Version-controlled**: each recalibration creates an immutable snapshot.
 *  - **Reversible**: any previous version can be restored via rollback.
 *
 * Integration points:
 *  - RiskScoringEngine: adjusts adaptive multipliers via `applyAdaptiveMultiplierDeltas`.
 *  - ClassificationEngine: feeds violation outcomes via `recordOutcome`.
 *  - HumanOverrideInterface: consumes `OverrideAdaptationSignal` for override-pattern analysis.
 */
export class ThresholdOptimizationEngine {
    // ── Configuration ────────────────────────────────────────────────────

    private readonly baseLearningRate: number;
    private readonly maxShiftPerCycle: number;
    private readonly minimumSignalCount: number;
    private readonly maxVersionHistory: number;
    private readonly signalDecayFactor: number;
    private readonly minimumLearningRate: number;
    private readonly maximumLearningRate: number;
    private readonly conservatismBiasRange: [number, number];
    private readonly dimensionSensitivityRange: [number, number];

    // ── State ────────────────────────────────────────────────────────────

    /** Pending signals waiting to be processed in the next optimization cycle */
    private signalBuffer: ReinforcementSignal[] = [];

    /** All processed signals for historical analysis */
    private signalHistory: ReinforcementSignal[] = [];

    /** Version history, ordered oldest-first */
    private versionHistory: ThresholdVersion[] = [];

    /** Current sequential version counter */
    private versionCounter: number = 0;

    /** Per-dimension sensitivity multipliers managed by this engine */
    private dimensionSensitivity: Record<RiskDimension, number>;

    /** Global conservatism bias applied across all threshold calculations */
    private conservatismBias: number = 0;

    /** Running EMA of false-positive rate for dampening */
    private falsePositiveRateEMA: number = 0;

    /** Running EMA of missed-violation rate for tightening */
    private missedViolationRateEMA: number = 0;

    constructor(config: ThresholdOptimizationConfig = {}) {
        this.baseLearningRate = this.clamp(config.baseLearningRate ?? 0.08, 0.001, 0.5);
        this.maxShiftPerCycle = this.clamp(config.maxShiftPerCycle ?? 5.0, 1.0, 20.0);
        this.minimumSignalCount = Math.max(1, config.minimumSignalCount ?? 3);
        this.maxVersionHistory = Math.max(10, config.maxVersionHistory ?? 100);
        this.signalDecayFactor = this.clamp(config.signalDecayFactor ?? 0.92, 0.5, 0.99);
        this.minimumLearningRate = this.clamp(config.minimumLearningRate ?? 0.005, 0.001, 0.1);
        this.maximumLearningRate = this.clamp(config.maximumLearningRate ?? 0.25, 0.05, 0.5);
        this.conservatismBiasRange = config.conservatismBiasRange ?? [-0.6, 0.6];
        this.dimensionSensitivityRange = config.dimensionSensitivityRange ?? [0.4, 2.0];

        // Initialize dimension sensitivities at neutral
        this.dimensionSensitivity = {
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

        // Create the initial baseline version
        this.createVersion('Initial baseline configuration', []);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SIGNAL INGESTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Ingests a single reinforcement signal into the pending buffer.
     * Signals are batched and processed together during `optimize()`.
     */
    public ingestSignal(signal: ReinforcementSignal): void {
        const validated: ReinforcementSignal = {
            ...signal,
            id: signal.id || uuidv4(),
            timestamp: signal.timestamp || new Date(),
            signalConfidence: this.clamp01(signal.signalConfidence),
        };

        this.signalBuffer.push(validated);

        console.log(
            `[ThresholdOptimizationEngine] Ingested ${validated.type} signal ` +
            `${validated.id} for decision ${validated.decisionId} ` +
            `(confidence: ${(validated.signalConfidence * 100).toFixed(1)}%)`
        );
    }

    /**
     * Ingests a batch of reinforcement signals.
     */
    public ingestSignals(signals: ReinforcementSignal[]): void {
        for (const signal of signals) {
            this.ingestSignal(signal);
        }
    }

    /**
     * Creates a ReinforcementSignal from a real-world outcome observation.
     */
    public createOutcomeSignal(
        decisionId: string,
        originalRiskScore: RiskScoreResult,
        originalClassification: ClassificationResult,
        outcome: {
            observedCompliance: number;
            stabilityIncident: boolean;
            costRatio: number;
        },
        confidence: number = 0.9
    ): ReinforcementSignal {
        return {
            id: uuidv4(),
            type: 'REAL_OUTCOME',
            timestamp: new Date(),
            decisionId,
            originalRiskScore,
            originalClassification,
            observedCompliance: this.clamp01(outcome.observedCompliance),
            stabilityIncident: outcome.stabilityIncident,
            costRatio: Math.max(0, outcome.costRatio),
            signalConfidence: this.clamp01(confidence),
        };
    }

    /**
     * Creates a ReinforcementSignal from a human override record.
     */
    public createOverrideSignal(
        decisionId: string,
        originalRiskScore: RiskScoreResult,
        originalClassification: ClassificationResult,
        overrideRecord: OverrideRecord
    ): ReinforcementSignal {
        return {
            id: uuidv4(),
            type: 'HUMAN_OVERRIDE',
            timestamp: new Date(),
            decisionId,
            originalRiskScore,
            originalClassification,
            overrideRecord,
            signalConfidence: overrideRecord.rationale.confidenceLevel,
        };
    }

    /**
     * Creates a ReinforcementSignal for a false positive (over-restriction).
     */
    public createFalsePositiveSignal(
        decisionId: string,
        originalRiskScore: RiskScoreResult,
        originalClassification: ClassificationResult,
        overPenalizedDimensions: RiskDimension[],
        confidence: number = 0.8
    ): ReinforcementSignal {
        return {
            id: uuidv4(),
            type: 'FALSE_POSITIVE',
            timestamp: new Date(),
            decisionId,
            originalRiskScore,
            originalClassification,
            overPenalizedDimensions,
            signalConfidence: this.clamp01(confidence),
        };
    }

    /**
     * Creates a ReinforcementSignal for a missed violation (under-restriction).
     */
    public createMissedViolationSignal(
        decisionId: string,
        originalRiskScore: RiskScoreResult,
        originalClassification: ClassificationResult,
        missedDimensions: RiskDimension[],
        severity: number = 0.7,
        confidence: number = 0.85
    ): ReinforcementSignal {
        return {
            id: uuidv4(),
            type: 'MISSED_VIOLATION',
            timestamp: new Date(),
            decisionId,
            originalRiskScore,
            originalClassification,
            missedDimensions,
            missedSeverity: this.clamp01(severity),
            signalConfidence: this.clamp01(confidence),
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  OPTIMIZATION CYCLE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Runs an optimization cycle: processes all buffered signals, derives
     * threshold adjustments, creates a new version, and applies changes
     * to the RiskScoringEngine and ClassificationEngine.
     *
     * Returns null if insufficient signals are buffered.
     */
    public optimize(
        scoringEngine: RiskScoringEngine,
        classificationEngine: ClassificationEngine,
        overrideAdaptationSignal?: OverrideAdaptationSignal
    ): OptimizationReport | null {
        if (this.signalBuffer.length < this.minimumSignalCount) {
            console.log(
                `[ThresholdOptimizationEngine] Skipping optimization: ` +
                `${this.signalBuffer.length}/${this.minimumSignalCount} signals buffered`
            );
            return null;
        }

        const signals = [...this.signalBuffer];
        this.signalBuffer = [];

        // Archive processed signals
        this.signalHistory.push(...signals);
        if (this.signalHistory.length > this.maxVersionHistory * 20) {
            this.signalHistory = this.signalHistory.slice(-this.maxVersionHistory * 10);
        }

        // Count signal types
        const signalTypeCounts: Record<ReinforcementSignalType, number> = {
            REAL_OUTCOME: 0,
            HUMAN_OVERRIDE: 0,
            FALSE_POSITIVE: 0,
            MISSED_VIOLATION: 0,
        };
        for (const s of signals) {
            signalTypeCounts[s.type]++;
        }

        // ── Apply temporal decay to signal confidence ────────────────────

        const now = Date.now();
        const decayedSignals = signals.map((s) => {
            const ageMs = now - s.timestamp.getTime();
            const ageHours = ageMs / (1000 * 60 * 60);
            const decay = Math.pow(this.signalDecayFactor, ageHours / 24);
            return { ...s, effectiveWeight: s.signalConfidence * decay };
        });

        // ── Compute dimension-level adjustments ─────────────────────────

        const dimensionDeltas = this.computeDimensionDeltas(decayedSignals);

        // ── Compute conservatism bias adjustment ────────────────────────

        const conservatismDelta = this.computeConservatismDelta(
            decayedSignals,
            overrideAdaptationSignal
        );

        // ── Compute threshold band shifts ───────────────────────────────

        const thresholdBandShift = this.computeThresholdBandShift(
            decayedSignals,
            conservatismDelta
        );

        // ── Compute effective learning rate ─────────────────────────────

        const avgConfidence = decayedSignals.reduce(
            (sum, s) => sum + s.effectiveWeight, 0
        ) / decayedSignals.length;
        const effectiveLearningRate = this.clamp(
            this.baseLearningRate * avgConfidence,
            this.minimumLearningRate,
            this.maximumLearningRate
        );

        // ── Apply dampening for safety ──────────────────────────────────

        let dampened = false;
        const cappedDimensionDeltas = this.capDeltas(dimensionDeltas, effectiveLearningRate);

        const cappedAutoApproveShift = this.clamp(
            thresholdBandShift.autoApproveMinDelta * effectiveLearningRate,
            -this.maxShiftPerCycle,
            this.maxShiftPerCycle
        );
        const cappedBlockMaxShift = this.clamp(
            thresholdBandShift.blockMaxDelta * effectiveLearningRate,
            -this.maxShiftPerCycle,
            this.maxShiftPerCycle
        );

        // Check if capping truncated any values
        for (const key of Object.keys(dimensionDeltas) as RiskDimension[]) {
            if (
                cappedDimensionDeltas[key] !== undefined &&
                dimensionDeltas[key] !== undefined &&
                Math.abs(cappedDimensionDeltas[key]! - dimensionDeltas[key]! * effectiveLearningRate) > 0.001
            ) {
                dampened = true;
                break;
            }
        }

        // ── Apply dimension sensitivity changes ─────────────────────────

        const [minSens, maxSens] = this.dimensionSensitivityRange;
        for (const key of Object.keys(cappedDimensionDeltas) as RiskDimension[]) {
            const delta = cappedDimensionDeltas[key];
            if (typeof delta === 'number' && Number.isFinite(delta)) {
                this.dimensionSensitivity[key] = this.clamp(
                    this.dimensionSensitivity[key] + delta,
                    minSens,
                    maxSens
                );
            }
        }

        // ── Apply conservatism bias ─────────────────────────────────────

        const cappedConservatismDelta = this.clamp(
            conservatismDelta * effectiveLearningRate,
            -0.15,
            0.15
        );
        this.conservatismBias = this.clamp(
            this.conservatismBias + cappedConservatismDelta,
            this.conservatismBiasRange[0],
            this.conservatismBiasRange[1]
        );

        // ── Update EMA trackers ─────────────────────────────────────────

        const fpCount = signalTypeCounts.FALSE_POSITIVE;
        const mvCount = signalTypeCounts.MISSED_VIOLATION;
        const total = signals.length;
        const emaAlpha = 0.3;

        this.falsePositiveRateEMA =
            this.falsePositiveRateEMA * (1 - emaAlpha) + (fpCount / total) * emaAlpha;
        this.missedViolationRateEMA =
            this.missedViolationRateEMA * (1 - emaAlpha) + (mvCount / total) * emaAlpha;

        // ── Apply to external engines ───────────────────────────────────

        // Push dimension deltas into RiskScoringEngine's adaptive multipliers
        scoringEngine.applyAdaptiveMultiplierDeltas(
            cappedDimensionDeltas,
            effectiveLearningRate
        );

        // Feed violation/false-positive outcomes into ClassificationEngine
        for (const signal of signals) {
            if (signal.type === 'MISSED_VIOLATION') {
                classificationEngine.recordOutcome({
                    violated: true,
                    severity: signal.missedSeverity ?? 0.7,
                });
            } else if (signal.type === 'FALSE_POSITIVE') {
                classificationEngine.recordOutcome({
                    violated: false,
                    severity: 0,
                });
            } else if (signal.type === 'REAL_OUTCOME') {
                const complianceOk = (signal.observedCompliance ?? 1) > 0.7;
                classificationEngine.recordOutcome({
                    violated: !complianceOk,
                    severity: complianceOk ? 0 : (1 - (signal.observedCompliance ?? 0)) * 0.8,
                });
            }
        }

        // ── Snapshot the previous version ───────────────────────────────

        const previousVersion = this.getActiveVersion();

        // ── Create new version ──────────────────────────────────────────

        const changeReason = this.buildChangeReason(signalTypeCounts, dampened);
        const triggeringSignalIds = signals.map((s) => s.id);
        const newVersion = this.createVersion(changeReason, triggeringSignalIds);

        // ── Build report ────────────────────────────────────────────────

        const report: OptimizationReport = {
            newVersion,
            previousVersion,
            signalsProcessed: signals.length,
            signalTypeCounts,
            appliedDimensionDeltas: cappedDimensionDeltas,
            thresholdBandShift: {
                autoApproveMinDelta: Number(cappedAutoApproveShift.toFixed(4)),
                blockMaxDelta: Number(cappedBlockMaxShift.toFixed(4)),
            },
            conservatismBiasDelta: Number(cappedConservatismDelta.toFixed(4)),
            effectiveLearningRate: Number(effectiveLearningRate.toFixed(4)),
            dampened,
        };

        console.log(
            `[ThresholdOptimizationEngine] Optimization cycle complete → ` +
            `v${newVersion.versionNumber} | ${signals.length} signals | ` +
            `lr=${effectiveLearningRate.toFixed(4)} | ` +
            `bias=${this.conservatismBias.toFixed(4)} | ` +
            `dampened=${dampened}`
        );

        return report;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  VERSION CONTROL
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Returns the currently active threshold version, or null if none exists.
     */
    public getActiveVersion(): ThresholdVersion | null {
        for (let i = this.versionHistory.length - 1; i >= 0; i--) {
            if (this.versionHistory[i].active) {
                return this.versionHistory[i];
            }
        }
        return null;
    }

    /**
     * Returns the complete version history.
     */
    public getVersionHistory(): ThresholdVersion[] {
        return [...this.versionHistory];
    }

    /**
     * Returns a specific version by its version ID.
     */
    public getVersion(versionId: string): ThresholdVersion | undefined {
        return this.versionHistory.find((v) => v.versionId === versionId);
    }

    /**
     * Returns a specific version by its version number.
     */
    public getVersionByNumber(versionNumber: number): ThresholdVersion | undefined {
        return this.versionHistory.find((v) => v.versionNumber === versionNumber);
    }

    /**
     * Rolls back to a previous threshold version. Restores the engine's
     * dimension sensitivities and conservatism bias to the target version's
     * state, and pushes the restoration into the connected engines.
     *
     * A new version snapshot is created to record the rollback event.
     */
    public rollback(
        targetVersionId: string,
        reason: string,
        scoringEngine: RiskScoringEngine,
        classificationEngine: ClassificationEngine
    ): RollbackResult {
        const targetVersion = this.versionHistory.find(
            (v) => v.versionId === targetVersionId
        );
        if (!targetVersion) {
            return {
                success: false,
                rolledBackFrom: this.getActiveVersion()!,
                rolledBackTo: this.getActiveVersion()!,
                reason: `Version ${targetVersionId} not found in history`,
            };
        }

        const currentVersion = this.getActiveVersion()!;

        // Restore engine state from the target version snapshot
        this.dimensionSensitivity = { ...targetVersion.dimensionSensitivity };
        this.conservatismBias = targetVersion.conservatismBias;

        // Compute the delta needed to move scoring engine multipliers from
        // current state back to target state
        const currentMultipliers = scoringEngine.getAdaptiveMultipliersSnapshot();
        const targetMultipliers = targetVersion.adaptiveMultipliers;
        const rollbackDeltas: Partial<Record<RiskDimension, number>> = {};

        for (const key of Object.keys(targetMultipliers) as RiskDimension[]) {
            const delta = targetMultipliers[key] - currentMultipliers[key];
            if (Math.abs(delta) > 0.0001) {
                rollbackDeltas[key] = delta;
            }
        }

        // Apply rollback deltas with a learning rate of 1.0 (direct restoration)
        if (Object.keys(rollbackDeltas).length > 0) {
            scoringEngine.applyAdaptiveMultiplierDeltas(rollbackDeltas, 1.0);
        }

        // Deactivate current version
        currentVersion.active = false;

        // Create a rollback version record
        const rollbackVersion = this.createVersion(
            `ROLLBACK: Restored to v${targetVersion.versionNumber} — ${reason}`,
            []
        );

        console.log(
            `[ThresholdOptimizationEngine] ROLLBACK: v${currentVersion.versionNumber} → ` +
            `v${targetVersion.versionNumber} (recorded as v${rollbackVersion.versionNumber}) | ${reason}`
        );

        return {
            success: true,
            rolledBackFrom: currentVersion,
            rolledBackTo: rollbackVersion,
            reason,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ANALYTICS & INTROSPECTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Returns the current dimension sensitivity configuration.
     */
    public getDimensionSensitivity(): Record<RiskDimension, number> {
        return { ...this.dimensionSensitivity };
    }

    /**
     * Returns the current conservatism bias.
     */
    public getConservatismBias(): number {
        return this.conservatismBias;
    }

    /**
     * Returns the count of pending unprocessed signals.
     */
    public getPendingSignalCount(): number {
        return this.signalBuffer.length;
    }

    /**
     * Returns EMA-smoothed false positive and missed violation rates.
     */
    public getErrorRateIndicators(): {
        falsePositiveRateEMA: number;
        missedViolationRateEMA: number;
    } {
        return {
            falsePositiveRateEMA: Number(this.falsePositiveRateEMA.toFixed(4)),
            missedViolationRateEMA: Number(this.missedViolationRateEMA.toFixed(4)),
        };
    }

    /**
     * Returns a summary of the total processed signal history by type.
     */
    public getSignalHistorySummary(): {
        total: number;
        byType: Record<ReinforcementSignalType, number>;
        averageConfidence: number;
    } {
        const byType: Record<ReinforcementSignalType, number> = {
            REAL_OUTCOME: 0,
            HUMAN_OVERRIDE: 0,
            FALSE_POSITIVE: 0,
            MISSED_VIOLATION: 0,
        };

        let totalConfidence = 0;
        for (const s of this.signalHistory) {
            byType[s.type]++;
            totalConfidence += s.signalConfidence;
        }

        return {
            total: this.signalHistory.length,
            byType,
            averageConfidence: this.signalHistory.length > 0
                ? Number((totalConfidence / this.signalHistory.length).toFixed(4))
                : 0,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PRIVATE COMPUTATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Computes per-dimension adjustment deltas from the decayed signal batch.
     *
     * - FALSE_POSITIVE signals push negative deltas on over-penalized dimensions
     *   (relax those dimensions).
     * - MISSED_VIOLATION signals push positive deltas on missed dimensions
     *   (tighten those dimensions).
     * - HUMAN_OVERRIDE signals use stakeholder dimension disagreements.
     * - REAL_OUTCOME signals compare observed vs predicted to derive error-based deltas.
     */
    private computeDimensionDeltas(
        signals: (ReinforcementSignal & { effectiveWeight: number })[]
    ): Partial<Record<RiskDimension, number>> {
        const accumulators: Record<RiskDimension, { sum: number; weightSum: number }> = {} as any;
        const allDimensions: RiskDimension[] = [
            'operationalRisk', 'regulatoryExposure', 'financialCost',
            'reputationalImpact', 'cooperativeSystemStability',
            'predictedComplianceProbability', 'simulationImpact',
            'opportunityCostProjection', 'strategicMisalignment',
        ];

        for (const dim of allDimensions) {
            accumulators[dim] = { sum: 0, weightSum: 0 };
        }

        for (const signal of signals) {
            const w = signal.effectiveWeight;

            switch (signal.type) {
                case 'FALSE_POSITIVE': {
                    // Relax over-penalized dimensions
                    if (signal.overPenalizedDimensions) {
                        for (const dim of signal.overPenalizedDimensions) {
                            accumulators[dim].sum += -0.6 * w;
                            accumulators[dim].weightSum += w;
                        }
                    }
                    // Also mildly relax all risk dimensions globally
                    for (const dim of allDimensions) {
                        accumulators[dim].sum += -0.1 * w;
                        accumulators[dim].weightSum += w * 0.3;
                    }
                    break;
                }

                case 'MISSED_VIOLATION': {
                    // Tighten missed dimensions
                    const severity = signal.missedSeverity ?? 0.7;
                    if (signal.missedDimensions) {
                        for (const dim of signal.missedDimensions) {
                            accumulators[dim].sum += 0.8 * severity * w;
                            accumulators[dim].weightSum += w;
                        }
                    }
                    // Mildly tighten all risk dimensions globally
                    for (const dim of allDimensions) {
                        accumulators[dim].sum += 0.15 * severity * w;
                        accumulators[dim].weightSum += w * 0.3;
                    }
                    break;
                }

                case 'HUMAN_OVERRIDE': {
                    if (signal.overrideRecord) {
                        const record = signal.overrideRecord;
                        for (const disagreement of record.rationale.dimensionDisagreements) {
                            const dim = disagreement.dimension as RiskDimension;
                            if (accumulators[dim]) {
                                // Positive stakeholderAssessment = system overweighted → relax (negative delta)
                                // Negative stakeholderAssessment = system underweighted → tighten (positive delta)
                                accumulators[dim].sum += -disagreement.stakeholderAssessment * w;
                                accumulators[dim].weightSum += w;
                            }
                        }

                        // Override verdict provides a global direction signal
                        if (record.verdict === 'APPROVED') {
                            // System was too strict → mild global relaxation
                            for (const dim of allDimensions) {
                                accumulators[dim].sum += -0.08 * w;
                                accumulators[dim].weightSum += w * 0.2;
                            }
                        } else if (record.verdict === 'REJECTED') {
                            // System was correct or too lenient → mild global tightening
                            for (const dim of allDimensions) {
                                accumulators[dim].sum += 0.08 * w;
                                accumulators[dim].weightSum += w * 0.2;
                            }
                        }
                    }
                    break;
                }

                case 'REAL_OUTCOME': {
                    const compliance = signal.observedCompliance ?? 0.8;
                    const predicted = signal.originalRiskScore.breakdown.dimensionScores;

                    // If compliance was poor but predicted compliance was high → underweighted regulation
                    const complianceError = compliance - predicted.predictedComplianceProbability;
                    if (complianceError < -0.1) {
                        accumulators.regulatoryExposure.sum += -complianceError * 0.5 * w;
                        accumulators.regulatoryExposure.weightSum += w;
                        accumulators.predictedComplianceProbability.sum += -complianceError * 0.4 * w;
                        accumulators.predictedComplianceProbability.weightSum += w;
                    } else if (complianceError > 0.1) {
                        // System was too pessimistic about compliance → relax
                        accumulators.regulatoryExposure.sum += -complianceError * 0.3 * w;
                        accumulators.regulatoryExposure.weightSum += w;
                    }

                    // If stability incident occurred where none was predicted
                    if (signal.stabilityIncident) {
                        accumulators.cooperativeSystemStability.sum += 0.4 * w;
                        accumulators.cooperativeSystemStability.weightSum += w;
                        accumulators.operationalRisk.sum += 0.3 * w;
                        accumulators.operationalRisk.weightSum += w;
                    }

                    // Cost overrun detection
                    if ((signal.costRatio ?? 1) > 1.2) {
                        const overrunPenalty = Math.min((signal.costRatio! - 1) * 0.3, 0.5);
                        accumulators.financialCost.sum += overrunPenalty * w;
                        accumulators.financialCost.weightSum += w;
                    }
                    break;
                }
            }
        }

        // Collapse weighted accumulators into deltas
        const deltas: Partial<Record<RiskDimension, number>> = {};
        for (const dim of allDimensions) {
            const acc = accumulators[dim];
            if (acc.weightSum > 0) {
                deltas[dim] = Number((acc.sum / acc.weightSum).toFixed(6));
            }
        }

        return deltas;
    }

    /**
     * Computes a conservatism bias adjustment from the signal batch.
     * False positives push toward relaxation (negative), missed violations
     * push toward strictness (positive).
     */
    private computeConservatismDelta(
        signals: (ReinforcementSignal & { effectiveWeight: number })[],
        overrideSignal?: OverrideAdaptationSignal
    ): number {
        let biasPressure = 0;
        let totalWeight = 0;

        for (const signal of signals) {
            const w = signal.effectiveWeight;

            switch (signal.type) {
                case 'FALSE_POSITIVE':
                    biasPressure += -0.5 * w;
                    totalWeight += w;
                    break;
                case 'MISSED_VIOLATION':
                    biasPressure += 0.7 * (signal.missedSeverity ?? 0.7) * w;
                    totalWeight += w;
                    break;
                case 'HUMAN_OVERRIDE':
                    if (signal.overrideRecord?.verdict === 'APPROVED') {
                        biasPressure += -0.3 * w;
                    } else if (signal.overrideRecord?.verdict === 'REJECTED') {
                        biasPressure += 0.2 * w;
                    }
                    totalWeight += w;
                    break;
                case 'REAL_OUTCOME':
                    if (signal.stabilityIncident) {
                        biasPressure += 0.4 * w;
                    } else if ((signal.observedCompliance ?? 1) > 0.85) {
                        biasPressure += -0.15 * w;
                    }
                    totalWeight += w;
                    break;
            }
        }

        // Incorporate override pattern analysis if available
        if (overrideSignal && overrideSignal.sampleSize >= 5) {
            // High approval rate suggests system is too conservative
            if (overrideSignal.approvalRate > 0.6) {
                biasPressure += -0.3 * overrideSignal.averageConfidence;
                totalWeight += overrideSignal.averageConfidence;
            }
            // High rejection rate confirms conservatism is warranted
            if (overrideSignal.rejectionRate > 0.5) {
                biasPressure += 0.2 * overrideSignal.averageConfidence;
                totalWeight += overrideSignal.averageConfidence;
            }
        }

        return totalWeight > 0 ? biasPressure / totalWeight : 0;
    }

    /**
     * Computes threshold band shifts for the ClassificationEngine.
     */
    private computeThresholdBandShift(
        signals: (ReinforcementSignal & { effectiveWeight: number })[],
        conservatismDelta: number
    ): { autoApproveMinDelta: number; blockMaxDelta: number } {
        // Conservatism increases → raise both thresholds (stricter)
        // Conservatism decreases → lower both thresholds (more permissive)
        const directionMultiplier = conservatismDelta;

        // False positives specifically suggest lowering the auto-approve threshold
        const fpWeight = this.falsePositiveRateEMA;
        const mvWeight = this.missedViolationRateEMA;

        // auto-approve: raise on missed violations, lower on false positives
        const autoApproveMinDelta =
            (directionMultiplier * 6.0) +
            (mvWeight * 4.0) -
            (fpWeight * 5.0);

        // block threshold: raise on missed violations, lower on false positives
        const blockMaxDelta =
            (directionMultiplier * 4.0) +
            (mvWeight * 6.0) -
            (fpWeight * 3.0);

        return {
            autoApproveMinDelta: Number(autoApproveMinDelta.toFixed(4)),
            blockMaxDelta: Number(blockMaxDelta.toFixed(4)),
        };
    }

    /**
     * Caps dimension deltas to the maximum allowed shift per cycle.
     */
    private capDeltas(
        deltas: Partial<Record<RiskDimension, number>>,
        learningRate: number
    ): Partial<Record<RiskDimension, number>> {
        const capped: Partial<Record<RiskDimension, number>> = {};
        const maxDelta = this.maxShiftPerCycle * 0.1; // Convert score-points to multiplier scale

        for (const key of Object.keys(deltas) as RiskDimension[]) {
            const raw = deltas[key];
            if (typeof raw === 'number' && Number.isFinite(raw)) {
                capped[key] = Number(
                    this.clamp(raw * learningRate, -maxDelta, maxDelta).toFixed(6)
                );
            }
        }

        return capped;
    }

    /**
     * Creates a new versioned snapshot of the current engine state.
     */
    private createVersion(
        changeReason: string,
        triggeringSignalIds: string[]
    ): ThresholdVersion {
        // Deactivate the previous active version
        for (const v of this.versionHistory) {
            v.active = false;
        }

        this.versionCounter++;

        const version: ThresholdVersion = {
            versionId: uuidv4(),
            versionNumber: this.versionCounter,
            createdAt: new Date(),
            changeReason,
            triggeringSignalIds: [...triggeringSignalIds],
            thresholdBand: {
                autoApproveMin: 72 + (this.conservatismBias * 12),
                blockMax: 42 + (this.conservatismBias * 8),
            },
            adaptiveMultipliers: { ...this.dimensionSensitivity },
            dimensionSensitivity: { ...this.dimensionSensitivity },
            conservatismBias: this.conservatismBias,
            active: true,
        };

        this.versionHistory.push(version);

        // Trim history to max depth
        if (this.versionHistory.length > this.maxVersionHistory) {
            this.versionHistory = this.versionHistory.slice(
                this.versionHistory.length - this.maxVersionHistory
            );
        }

        return version;
    }

    /**
     * Builds a human-readable change reason from signal type counts.
     */
    private buildChangeReason(
        counts: Record<ReinforcementSignalType, number>,
        dampened: boolean
    ): string {
        const parts: string[] = [];

        if (counts.REAL_OUTCOME > 0) {
            parts.push(`${counts.REAL_OUTCOME} outcome(s)`);
        }
        if (counts.HUMAN_OVERRIDE > 0) {
            parts.push(`${counts.HUMAN_OVERRIDE} override(s)`);
        }
        if (counts.FALSE_POSITIVE > 0) {
            parts.push(`${counts.FALSE_POSITIVE} false positive(s)`);
        }
        if (counts.MISSED_VIOLATION > 0) {
            parts.push(`${counts.MISSED_VIOLATION} missed violation(s)`);
        }

        let reason = `Recalibrated from ${parts.join(', ')}`;
        if (dampened) {
            reason += ' [dampened by safety constraints]';
        }

        return reason;
    }

    // ── Utility ──────────────────────────────────────────────────────────

    private clamp01(value: number): number {
        return this.clamp(value, 0, 1);
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }
}

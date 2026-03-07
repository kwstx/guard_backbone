import {
    HistoricalOutcome,
    ThresholdAdaptationProfile,
    ThresholdAdaptationReport,
    Violation
} from './models';
import { EnforcementEventBus, EnforcementEvents } from './event-bus';

export class ThresholdAdaptationEngine {
    private static instance: ThresholdAdaptationEngine;
    private history: HistoricalOutcome[] = [];
    private currentProfile: ThresholdAdaptationProfile;
    private eventBus: EnforcementEventBus;

    private constructor() {
        this.eventBus = EnforcementEventBus.getInstance();
        this.currentProfile = {
            riskTolerance: 1.0,
            anomalySensitivity: 1.0,
            precisionWeight: 0.5,
            lastAdaptation: new Date()
        };
        this.initializeListeners();
    }

    public static getInstance(): ThresholdAdaptationEngine {
        if (!ThresholdAdaptationEngine.instance) {
            ThresholdAdaptationEngine.instance = new ThresholdAdaptationEngine();
        }
        return ThresholdAdaptationEngine.instance;
    }

    private initializeListeners() {
        // We could listen for outcome events here if they existed
        // For now, we'll provide a manual ingestion method
    }

    public recordOutcome(outcome: HistoricalOutcome): ThresholdAdaptationReport | null {
        this.history.push(outcome);
        console.log(`[ThresholdAdaptation] Recorded outcome for action ${outcome.actionId}. Real-world impact: ${outcome.realWorldImpact.toFixed(2)}`);

        // Adapt every 5 outcomes for demo purposes, usually would be a larger window or time-based
        if (this.history.length % 5 === 0) {
            return this.adapt();
        }
        return null;
    }

    public getCurrentProfile(): ThresholdAdaptationProfile {
        return { ...this.currentProfile };
    }

    public adapt(): ThresholdAdaptationReport {
        const previousProfile = { ...this.currentProfile };
        const windowSize = Math.min(this.history.length, 20);
        const recentHistory = this.history.slice(-windowSize);

        const falsePositives = recentHistory.filter(h => h.isFalsePositive || h.wasOverRestricted).length;
        const missedViolations = recentHistory.filter(h => h.wasUnderRestricted).length;
        const totalImpact = recentHistory.reduce((sum, h) => sum + h.realWorldImpact, 0);

        const falsePositiveRate = falsePositives / windowSize;
        const missedViolationRate = missedViolations / windowSize;
        const averageImpact = totalImpact / windowSize;

        let adaptationReason = 'Periodic adaptation based on historical performance.';

        // Logic to adjust thresholds
        // 1. If too many false positives, relax sensitivity and risk tolerance
        // 2. If missed violations or high real-world impact, tighten sensitivity and risk tolerance
        // 3. Adjust precision weight based on what we see more of

        let riskToleranceDelta = 0;
        let anomalySensitivityDelta = 0;

        if (falsePositiveRate > 0.3) {
            // Too many false positives: loosen up
            riskToleranceDelta -= 0.1;
            anomalySensitivityDelta -= 0.1;
            adaptationReason = `High false positive rate (${(falsePositiveRate * 100).toFixed(0)}%) detected. Loosening thresholds to preserve autonomy.`;
        }

        if (missedViolationRate > 0.1 || averageImpact > 0.4) {
            // Too dangerous: tighten up
            riskToleranceDelta += 0.15;
            anomalySensitivityDelta += 0.15;
            adaptationReason = `Safety risk detected (Missed: ${(missedViolationRate * 100).toFixed(0)}%, Avg Impact: ${averageImpact.toFixed(2)}). Tightening guardrails.`;
        }

        // Apply deltas with clamping
        this.currentProfile.riskTolerance = Math.max(0.5, Math.min(2.0, this.currentProfile.riskTolerance + riskToleranceDelta));
        this.currentProfile.anomalySensitivity = Math.max(0.5, Math.min(2.0, this.currentProfile.anomalySensitivity + anomalySensitivityDelta));

        // Precision weight adjustment: if we see more missed violations, favor recall. If more false positives, favor precision.
        if (missedViolationRate > falsePositiveRate) {
            this.currentProfile.precisionWeight = Math.max(0.2, this.currentProfile.precisionWeight - 0.05); // Lower weight means more focus on catching things
        } else if (falsePositiveRate > missedViolationRate) {
            this.currentProfile.precisionWeight = Math.min(0.8, this.currentProfile.precisionWeight + 0.05); // Higher weight means more focus on accuracy
        }

        this.currentProfile.lastAdaptation = new Date();

        const report: ThresholdAdaptationReport = {
            previousProfile,
            updatedProfile: { ...this.currentProfile },
            adaptationReason,
            metrics: {
                falsePositiveRate,
                missedViolationRate,
                averageImpact
            }
        };

        console.log(`[ThresholdAdaptation] Engine adapted: ${adaptationReason}`);
        console.log(`[ThresholdAdaptation] New Profile: RiskTolerance=${this.currentProfile.riskTolerance.toFixed(2)}, AnomalySensitivity=${this.currentProfile.anomalySensitivity.toFixed(2)}, PrecisionWeight=${this.currentProfile.precisionWeight.toFixed(2)}`);

        return report;
    }
}

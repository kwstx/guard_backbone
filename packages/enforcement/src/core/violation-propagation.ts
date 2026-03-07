import { EnforcementEventBus, EnforcementEvents } from './event-bus';
import { Violation, ViolationSeverity, ViolationCategory } from './models';

export interface PropagationParameters {
    riskMultiplier: number; // Applied to predictive risk
    thresholdTightness: number; // 0.0 to 1.0, where 1.0 is maximum tightness
    trustDegradationFactor: number;
}

export class ViolationPropagationModule {
    private static instance: ViolationPropagationModule;
    private eventBus: EnforcementEventBus;

    // State tracked across all actions and layers
    private riskMultiplier: number = 1.0;
    private thresholdTightness: number = 0.0;
    private violationsHistory: Violation[] = [];

    private constructor() {
        this.eventBus = EnforcementEventBus.getInstance();
        this.initializeListeners();
    }

    public static getInstance(): ViolationPropagationModule {
        if (!ViolationPropagationModule.instance) {
            ViolationPropagationModule.instance = new ViolationPropagationModule();
        }
        return ViolationPropagationModule.instance;
    }

    private initializeListeners() {
        this.eventBus.on(EnforcementEvents.VIOLATION_DETECTED, ({ actionId, violation }: { actionId: string, violation: Violation }) => {
            this.handleViolation(violation);
        });
    }

    private handleViolation(violation: Violation) {
        this.violationsHistory.push(violation);

        console.log(`[ViolationPropagation] Propagating impact of ${violation.severity} violation from ${violation.sourceLayer}`);

        // Increase risk multiplier based on severity
        const multiplierInc = this.calculateMultiplierIncrease(violation);
        this.riskMultiplier = Math.min(5.0, this.riskMultiplier + multiplierInc);

        // Increase threshold tightness
        const tightnessInc = this.calculateTightnessIncrease(violation);
        this.thresholdTightness = Math.min(1.0, this.thresholdTightness + tightnessInc);

        console.log(`[ViolationPropagation] New state: RiskMultiplier=${this.riskMultiplier.toFixed(2)}, ThresholdTightness=${this.thresholdTightness.toFixed(2)}`);
    }

    private calculateMultiplierIncrease(violation: Violation): number {
        switch (violation.severity) {
            case ViolationSeverity.CRITICAL: return 0.5;
            case ViolationSeverity.HIGH: return 0.2;
            case ViolationSeverity.MEDIUM: return 0.1;
            case ViolationSeverity.LOW: return 0.02;
            default: return 0;
        }
    }

    private calculateTightnessIncrease(violation: Violation): number {
        // Post-execution violations (audits) cause more drastic tightening
        const isPostExec = violation.sourceLayer.includes('PostExecution');
        const base = isPostExec ? 0.2 : 0.05;

        switch (violation.severity) {
            case ViolationSeverity.CRITICAL: return base * 2.0;
            case ViolationSeverity.HIGH: return base * 1.5;
            case ViolationSeverity.MEDIUM: return base * 1.0;
            case ViolationSeverity.LOW: return base * 0.5;
            default: return 0;
        }
    }

    public getPropagationParameters(): PropagationParameters {
        return {
            riskMultiplier: this.riskMultiplier,
            thresholdTightness: this.thresholdTightness,
            trustDegradationFactor: Math.min(1.0, (this.riskMultiplier - 1.0) / 4.0)
        };
    }

    /**
     * Resets indicators (e.g., after human sign-off or cooldown period)
     */
    public recalibrate() {
        this.riskMultiplier = Math.max(1.0, this.riskMultiplier - 0.5);
        this.thresholdTightness = Math.max(0.0, this.thresholdTightness - 0.2);
        console.log(`[ViolationPropagation] Recalibrated state: RiskMultiplier=${this.riskMultiplier.toFixed(2)}, ThresholdTightness=${this.thresholdTightness.toFixed(2)}`);
    }
}

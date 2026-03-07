import {
    ActionContext,
    EnforcementDecisionExplanation,
    EnforcementState,
    RemediationReport,
    RiskProfile,
    ThresholdAdaptationProfile,
    Violation
} from './core/models';
import { EnforcementEventBus, EnforcementEvents } from './core/event-bus';
import { ThresholdAdaptationEngine } from './core/threshold-adaptation-engine';
import { ViolationPropagationModule } from './core/violation-propagation';
import { GuardrailOrchestrator } from './orchestrator/guardrail-orchestrator';

export interface GuardrailsActionHandle {
    actionId: string;
    completion: Promise<ActionContext>;
}

export interface GuardrailsLiveExecutionStatus {
    actionId: string;
    status: EnforcementState;
    isActive: boolean;
    startedAt?: Date;
    endedAt?: Date;
    lastUpdatedAt: Date;
    currentLayer: 'PRE_EXECUTION' | 'IN_PROCESS' | 'POST_EXECUTION' | 'UNKNOWN';
    violationCount: number;
    interventionCount: number;
    latestDecision?: EnforcementDecisionExplanation;
}

export interface GuardrailsPreExecutionAssessment {
    actionId: string;
    recommendation?: RiskProfile['recommendation'];
    riskProfile?: RiskProfile;
    explanations: EnforcementDecisionExplanation[];
}

export interface GuardrailsViolationLog {
    actionId: string;
    violations: Violation[];
    explanations: EnforcementDecisionExplanation[];
}

export interface GuardrailsRemediationView {
    actionId: string;
    interventions: ActionContext['interventions'];
    remediationReport?: RemediationReport;
    explanations: EnforcementDecisionExplanation[];
}

export interface GuardrailsAdaptiveThresholdView {
    thresholdProfile: ThresholdAdaptationProfile;
    propagationParameters: ReturnType<ViolationPropagationModule['getPropagationParameters']>;
}

export class GuardrailsAPI {
    private readonly orchestrator: GuardrailOrchestrator;
    private readonly eventBus: EnforcementEventBus;
    private readonly thresholdEngine: ThresholdAdaptationEngine;
    private readonly propagationModule: ViolationPropagationModule;
    private readonly contexts: Map<string, ActionContext>;
    private readonly liveStatus: Map<string, GuardrailsLiveExecutionStatus>;

    constructor(orchestrator?: GuardrailOrchestrator) {
        this.orchestrator = orchestrator || new GuardrailOrchestrator();
        this.eventBus = EnforcementEventBus.getInstance();
        this.thresholdEngine = ThresholdAdaptationEngine.getInstance();
        this.propagationModule = ViolationPropagationModule.getInstance();
        this.contexts = new Map();
        this.liveStatus = new Map();
        this.initializeListeners();
    }

    public startTrackedAction(agentId: string, intent: string, params: Record<string, any>): GuardrailsActionHandle {
        const actionId = `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this.upsertLiveStatus(actionId, EnforcementState.PENDING, true);

        const completion = this.orchestrator.coordinate(agentId, intent, params, { actionId }).then(context => {
            this.contexts.set(actionId, context);
            this.upsertLiveStatus(
                actionId,
                context.status,
                false,
                context.startTime,
                context.endTime,
                context
            );
            return context;
        });

        return { actionId, completion };
    }

    public async executeAndTrack(agentId: string, intent: string, params: Record<string, any>): Promise<ActionContext> {
        const handle = this.startTrackedAction(agentId, intent, params);
        return handle.completion;
    }

    public getPreExecutionRiskAssessment(actionId: string): GuardrailsPreExecutionAssessment | null {
        const context = this.contexts.get(actionId);
        if (!context) {
            return null;
        }

        return {
            actionId,
            recommendation: context.riskProfile?.recommendation,
            riskProfile: context.riskProfile,
            explanations: this.filterExplanations(context, 'PRE_EXECUTION')
        };
    }

    public getLiveExecutionStatus(actionId: string): GuardrailsLiveExecutionStatus | null {
        return this.liveStatus.get(actionId) || null;
    }

    public getViolationLogs(actionId: string): GuardrailsViolationLog | null {
        const context = this.contexts.get(actionId);
        if (!context) {
            return null;
        }

        return {
            actionId,
            violations: context.violations,
            explanations: context.decisionExplanations?.filter(d =>
                d.outcome === 'WARN' || d.outcome === 'BLOCK' || d.outcome === 'SUSPEND'
            ) || []
        };
    }

    public getRemediationActions(actionId: string): GuardrailsRemediationView | null {
        const context = this.contexts.get(actionId);
        if (!context) {
            return null;
        }

        return {
            actionId,
            interventions: context.interventions,
            remediationReport: context.remediationReport,
            explanations: context.decisionExplanations?.filter(d =>
                d.outcome === 'INTERVENE' || d.outcome === 'REMEDIATE' || d.layer === 'POST_EXECUTION'
            ) || []
        };
    }

    public getAdaptiveThresholdSettings(): GuardrailsAdaptiveThresholdView {
        return {
            thresholdProfile: this.thresholdEngine.getCurrentProfile(),
            propagationParameters: this.propagationModule.getPropagationParameters()
        };
    }

    public getDecisionExplanations(
        actionId: string,
        layer?: EnforcementDecisionExplanation['layer']
    ): EnforcementDecisionExplanation[] {
        const context = this.contexts.get(actionId);
        if (!context || !context.decisionExplanations) {
            return [];
        }

        if (!layer) {
            return context.decisionExplanations;
        }

        return context.decisionExplanations.filter(decision => decision.layer === layer);
    }

    public getActionSnapshot(actionId: string) {
        const context = this.contexts.get(actionId);
        const live = this.liveStatus.get(actionId);
        if (!context && !live) {
            return null;
        }

        return {
            actionId,
            liveStatus: live || null,
            preExecutionAssessment: context ? this.getPreExecutionRiskAssessment(actionId) : null,
            violations: context ? this.getViolationLogs(actionId) : null,
            remediation: context ? this.getRemediationActions(actionId) : null,
            decisionExplanations: context?.decisionExplanations || [],
            adaptiveThresholds: this.getAdaptiveThresholdSettings()
        };
    }

    private initializeListeners() {
        this.eventBus.on(EnforcementEvents.ACTION_PROPOSED, (context: ActionContext) => {
            this.contexts.set(context.actionId, context);
            this.upsertLiveStatus(context.actionId, context.status, true, context.startTime, undefined, context);
        });

        this.eventBus.on(EnforcementEvents.PRE_EXECUTION_COMPLETED, (context: ActionContext) => {
            this.contexts.set(context.actionId, context);
            this.upsertLiveStatus(context.actionId, context.status, true, context.startTime, undefined, context);
        });

        this.eventBus.on(EnforcementEvents.ACTION_EXECUTING, (context: ActionContext) => {
            this.contexts.set(context.actionId, context);
            this.upsertLiveStatus(context.actionId, context.status, true, context.startTime, undefined, context);
        });

        this.eventBus.on(EnforcementEvents.IN_PROCESS_UPDATE, (context: ActionContext) => {
            this.contexts.set(context.actionId, context);
            this.upsertLiveStatus(context.actionId, context.status, context.status === EnforcementState.EXECUTING, context.startTime, context.endTime, context);
        });

        this.eventBus.on(EnforcementEvents.AUDIT_COMPLETED, (context: ActionContext) => {
            this.contexts.set(context.actionId, context);
            this.upsertLiveStatus(context.actionId, context.status, false, context.startTime, context.endTime, context);
        });

        this.eventBus.on(EnforcementEvents.REMEDIATION_COMPLETED, (context: ActionContext) => {
            this.contexts.set(context.actionId, context);
            this.upsertLiveStatus(context.actionId, context.status, false, context.startTime, context.endTime, context);
        });
    }

    private upsertLiveStatus(
        actionId: string,
        status: EnforcementState,
        isActive: boolean,
        startedAt?: Date,
        endedAt?: Date,
        context?: ActionContext
    ) {
        const latestDecision = context?.decisionExplanations?.[context.decisionExplanations.length - 1];
        const currentLayer = latestDecision?.layer || 'UNKNOWN';
        const existing = this.liveStatus.get(actionId);

        this.liveStatus.set(actionId, {
            actionId,
            status,
            isActive,
            startedAt: startedAt || existing?.startedAt,
            endedAt: endedAt || existing?.endedAt,
            lastUpdatedAt: new Date(),
            currentLayer,
            violationCount: context?.violations.length || existing?.violationCount || 0,
            interventionCount: context?.interventions.length || existing?.interventionCount || 0,
            latestDecision: latestDecision || existing?.latestDecision
        });
    }

    private filterExplanations(
        context: ActionContext,
        layer: EnforcementDecisionExplanation['layer']
    ): EnforcementDecisionExplanation[] {
        return context.decisionExplanations?.filter(decision => decision.layer === layer) || [];
    }
}

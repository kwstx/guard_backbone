import { ActionContext, EnforcementDecisionExplanation, EnforcementDecisionOutcome, EnforcementLayer } from './models';

interface DecisionInput {
    layer: EnforcementLayer;
    component: string;
    outcome: EnforcementDecisionOutcome;
    summary: string;
    rationale: string[];
    evidence?: Record<string, unknown>;
}

export function appendDecisionExplanation(
    context: ActionContext,
    input: DecisionInput
): EnforcementDecisionExplanation {
    if (!context.decisionExplanations) {
        context.decisionExplanations = [];
    }

    const decision: EnforcementDecisionExplanation = {
        decisionId: `dec-${context.actionId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date(),
        layer: input.layer,
        component: input.component,
        outcome: input.outcome,
        summary: input.summary,
        rationale: input.rationale,
        evidence: input.evidence || {}
    };

    context.decisionExplanations.push(decision);
    return decision;
}

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DecisionEvaluationFramework, type RawAgentAction } from './DecisionEvaluationFramework.js';
import {
    RiskScoringEngine,
    type CooperativeSystemState,
    type RiskScoringContext,
    type RiskScoreResult
} from './RiskScoringEngine.js';
import {
    ClassificationEngine,
    type ClassificationResult,
    type ClassificationState
} from './ClassificationEngine.js';
import type { DecisionObject } from './DecisionObject.js';

export type EnforcementPlatform =
    | 'WINDOWS'
    | 'LINUX'
    | 'MACOS'
    | 'KUBERNETES'
    | 'CLOUD';

export interface GovernanceAuditEntry {
    step: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    detail: string;
}

export interface EnforcementDirective {
    platform: EnforcementPlatform;
    action: 'ALLOW' | 'REVIEW' | 'BLOCK';
    controlPlane: 'OS_POLICY' | 'RUNTIME_GATE' | 'WORKFLOW_APPROVAL' | 'NONE';
    controls: string[];
}

export interface ExplanationTraceItem {
    stage:
    | 'EVALUATION'
    | 'RISK_SCORING'
    | 'CLASSIFICATION'
    | 'ENFORCEMENT'
    | 'AUDIT';
    summary: string;
    evidence: Record<string, unknown>;
}

export interface EvaluateActionRequest {
    rawAction: RawAgentAction;
    riskContext: RiskScoringContext;
    systemState: CooperativeSystemState;
    classificationContext: {
        riskPosture: number;
        entropyLevel?: number;
        preemptiveRiskLift?: number;
        preemptiveEscalationThreshold?: number;
        preemptiveBlockThreshold?: number;
    };
    enforcement: {
        targetPlatforms: EnforcementPlatform[];
        actorId: string;
        policyPackVersion: string;
        governanceMode?: 'strict' | 'balanced';
    };
}

export interface DecisionBlockingApiResponse {
    evaluationId: string;
    evaluatedAt: Date;
    action: {
        decisionId: string;
        actionType: string;
        agentId: string;
        contextId: string;
    };
    compositeRiskScore: {
        decisionScore: number;
        riskPressure: number;
        riskBand: 'LOW' | 'MEDIUM' | 'HIGH';
        breakdown: RiskScoreResult['breakdown'];
    };
    simulationResults: DecisionObject['projectedImpact'];
    complianceProbability: {
        overall: number;
        lifecycle: DecisionObject['complianceForecast'] extends infer T
        ? T extends { lifecycleStageProbabilities: infer U }
        ? U
        : never
        : never;
        primaryRiskDrivers: string[];
        driftImpact: number;
    };
    strategicAlignmentRating: {
        overallAlignmentScore: number;
        misalignmentPenalty: number;
        flags: string[];
    };
    classificationState: ClassificationState;
    classification: ClassificationResult;
    enforcement: {
        outcome: 'ALLOW' | 'REVIEW' | 'BLOCK';
        directives: EnforcementDirective[];
        crossPlatformConsistent: boolean;
    };
    governanceAudit: {
        auditId: string;
        policyPackVersion: string;
        actorId: string;
        governanceMode: 'strict' | 'balanced';
        entries: GovernanceAuditEntry[];
        tamperEvidenceHash: string;
    };
    explanationTrace: ExplanationTraceItem[];
}

export class DecisionBlockingAPI {
    constructor(
        private readonly framework: DecisionEvaluationFramework = new DecisionEvaluationFramework(),
        private readonly scoringEngine: RiskScoringEngine = new RiskScoringEngine(),
        private readonly classificationEngine: ClassificationEngine = new ClassificationEngine()
    ) { }

    public async evaluateAction(
        request: EvaluateActionRequest
    ): Promise<DecisionBlockingApiResponse> {
        const decision = await this.framework.evaluateAction(request.rawAction);
        const riskResult = this.scoringEngine.scoreDecision(
            decision,
            request.riskContext,
            request.systemState
        );
        const classification = this.classificationEngine.classify(riskResult, request.classificationContext);
        const enforcementOutcome = this.mapClassificationToEnforcement(classification.state);
        const directives = this.buildDirectives(
            request.enforcement.targetPlatforms,
            enforcementOutcome,
            request.enforcement.governanceMode ?? 'balanced'
        );
        const governanceEntries = this.buildGovernanceEntries(decision, riskResult, classification, directives);
        const trace = this.buildTrace(decision, riskResult, classification, directives, governanceEntries);
        const lifecycle = decision.complianceForecast?.lifecycleStageProbabilities ?? {
            initiation: 0,
            execution: 0,
            persistence: 0,
            termination: 0
        };

        return {
            evaluationId: uuidv4(),
            evaluatedAt: new Date(),
            action: {
                decisionId: decision.id,
                actionType: decision.actionType,
                agentId: decision.metadata.agentId,
                contextId: decision.metadata.contextId
            },
            compositeRiskScore: {
                decisionScore: riskResult.decisionScore,
                riskPressure: riskResult.riskPressure,
                riskBand: this.toRiskBand(riskResult.riskPressure),
                breakdown: riskResult.breakdown
            },
            simulationResults: decision.projectedImpact,
            complianceProbability: {
                overall: decision.complianceForecast?.overallProbability ?? 0,
                lifecycle,
                primaryRiskDrivers: decision.complianceForecast?.primaryRiskDrivers ?? [],
                driftImpact: decision.complianceForecast?.estimatedDriftImpact ?? 0
            },
            strategicAlignmentRating: {
                overallAlignmentScore: decision.strategicAlignment?.overallAlignmentScore ?? 0,
                misalignmentPenalty: decision.strategicAlignment?.misalignmentPenalty ?? 0,
                flags: decision.strategicAlignment?.alignmentFlags ?? []
            },
            classificationState: classification.state,
            classification,
            enforcement: {
                outcome: enforcementOutcome,
                directives,
                crossPlatformConsistent: this.isCrossPlatformConsistent(directives)
            },
            governanceAudit: {
                auditId: uuidv4(),
                policyPackVersion: request.enforcement.policyPackVersion,
                actorId: request.enforcement.actorId,
                governanceMode: request.enforcement.governanceMode ?? 'balanced',
                entries: governanceEntries,
                tamperEvidenceHash: this.generateTamperEvidenceHash(decision.id, riskResult, classification, directives, governanceEntries)
            },
            explanationTrace: trace
        };
    }

    private toRiskBand(riskPressure: number): 'LOW' | 'MEDIUM' | 'HIGH' {
        if (riskPressure >= 0.66) return 'HIGH';
        if (riskPressure >= 0.33) return 'MEDIUM';
        return 'LOW';
    }

    private mapClassificationToEnforcement(state: ClassificationState): 'ALLOW' | 'REVIEW' | 'BLOCK' {
        if (state === 'auto-approve') return 'ALLOW';
        if (state === 'flag-for-review') return 'REVIEW';
        return 'BLOCK';
    }

    private buildDirectives(
        platforms: EnforcementPlatform[],
        outcome: 'ALLOW' | 'REVIEW' | 'BLOCK',
        governanceMode: 'strict' | 'balanced'
    ): EnforcementDirective[] {
        const uniquePlatforms = Array.from(new Set(platforms));
        return uniquePlatforms.map((platform) => {
            if (outcome === 'ALLOW') {
                return {
                    platform,
                    action: 'ALLOW',
                    controlPlane: 'NONE',
                    controls: ['log-only']
                };
            }

            if (outcome === 'REVIEW') {
                return {
                    platform,
                    action: 'REVIEW',
                    controlPlane: 'WORKFLOW_APPROVAL',
                    controls: governanceMode === 'strict'
                        ? ['require-two-person-approval', 'immutable-audit-log']
                        : ['require-single-approver', 'immutable-audit-log']
                };
            }

            return {
                platform,
                action: 'BLOCK',
                controlPlane: platform === 'CLOUD' || platform === 'KUBERNETES'
                    ? 'RUNTIME_GATE'
                    : 'OS_POLICY',
                controls: governanceMode === 'strict'
                    ? ['deny-execution', 'alert-soc', 'immutable-audit-log']
                    : ['deny-execution', 'immutable-audit-log']
            };
        });
    }

    private buildGovernanceEntries(
        decision: DecisionObject,
        riskResult: RiskScoreResult,
        classification: ClassificationResult,
        directives: EnforcementDirective[]
    ): GovernanceAuditEntry[] {
        const entries: GovernanceAuditEntry[] = [];
        entries.push({
            step: 'policy-exposure-check',
            status: decision.policyExposure.some((p) => p.exposureLevel > 0.7) ? 'WARN' : 'PASS',
            detail: `max-policy-exposure=${Math.max(...decision.policyExposure.map((p) => p.exposureLevel), 0).toFixed(2)}`
        });
        entries.push({
            step: 'risk-computation',
            status: riskResult.riskPressure > 0.66 ? 'WARN' : 'PASS',
            detail: `risk-pressure=${riskResult.riskPressure.toFixed(4)}, score=${riskResult.decisionScore}`
        });
        entries.push({
            step: 'classification-resolution',
            status: classification.state === 'block' ? 'WARN' : 'PASS',
            detail: `classification=${classification.state}`
        });
        entries.push({
            step: 'cross-platform-enforcement',
            status: this.isCrossPlatformConsistent(directives) ? 'PASS' : 'FAIL',
            detail: `directives=${directives.length}`
        });

        return entries;
    }

    private buildTrace(
        decision: DecisionObject,
        riskResult: RiskScoreResult,
        classification: ClassificationResult,
        directives: EnforcementDirective[],
        auditEntries: GovernanceAuditEntry[]
    ): ExplanationTraceItem[] {
        return [
            {
                stage: 'EVALUATION',
                summary: 'Decision object produced from raw action with simulation and compliance projection.',
                evidence: {
                    decisionId: decision.id,
                    actionType: decision.actionType,
                    complianceProbability: decision.complianceForecast?.overallProbability ?? 0
                }
            },
            {
                stage: 'RISK_SCORING',
                summary: 'Composite risk score computed with adaptive dimension weighting.',
                evidence: {
                    decisionScore: riskResult.decisionScore,
                    riskPressure: riskResult.riskPressure,
                    weightedRisk: riskResult.breakdown.weightedRisk
                }
            },
            {
                stage: 'CLASSIFICATION',
                summary: 'Adaptive thresholding resolved final classification state.',
                evidence: {
                    classificationState: classification.state,
                    thresholdBand: classification.thresholdBand,
                    shiftMagnitude: classification.shiftMagnitude
                }
            },
            {
                stage: 'ENFORCEMENT',
                summary: 'Cross-platform enforcement directives derived from classification.',
                evidence: {
                    directives
                }
            },
            {
                stage: 'AUDIT',
                summary: 'Governance audit entries generated for accountability and replay.',
                evidence: {
                    auditEntries
                }
            }
        ];
    }

    private isCrossPlatformConsistent(directives: EnforcementDirective[]): boolean {
        if (directives.length === 0) return true;
        const firstAction = directives[0].action;
        return directives.every((directive) => directive.action === firstAction);
    }

    private generateTamperEvidenceHash(
        decisionId: string,
        riskResult: RiskScoreResult,
        classification: ClassificationResult,
        directives: EnforcementDirective[],
        entries: GovernanceAuditEntry[]
    ): string {
        const payload = JSON.stringify({
            decisionId,
            riskResult,
            classification,
            directives,
            entries
        });
        return createHash('sha256').update(payload).digest('hex');
    }
}


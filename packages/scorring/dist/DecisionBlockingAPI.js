import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DecisionEvaluationFramework } from './DecisionEvaluationFramework.js';
import { RiskScoringEngine } from './RiskScoringEngine.js';
import { ClassificationEngine } from './ClassificationEngine.js';
export class DecisionBlockingAPI {
    framework;
    scoringEngine;
    classificationEngine;
    constructor(framework = new DecisionEvaluationFramework(), scoringEngine = new RiskScoringEngine(), classificationEngine = new ClassificationEngine()) {
        this.framework = framework;
        this.scoringEngine = scoringEngine;
        this.classificationEngine = classificationEngine;
    }
    async evaluateAction(request) {
        const decision = await this.framework.evaluateAction(request.rawAction);
        const riskResult = this.scoringEngine.scoreDecision(decision, request.riskContext, request.systemState);
        const classification = this.classificationEngine.classify(riskResult, request.classificationContext);
        const enforcementOutcome = this.mapClassificationToEnforcement(classification.state);
        const directives = this.buildDirectives(request.enforcement.targetPlatforms, enforcementOutcome, request.enforcement.governanceMode ?? 'balanced');
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
    toRiskBand(riskPressure) {
        if (riskPressure >= 0.66)
            return 'HIGH';
        if (riskPressure >= 0.33)
            return 'MEDIUM';
        return 'LOW';
    }
    mapClassificationToEnforcement(state) {
        if (state === 'auto-approve')
            return 'ALLOW';
        if (state === 'flag-for-review')
            return 'REVIEW';
        return 'BLOCK';
    }
    buildDirectives(platforms, outcome, governanceMode) {
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
    buildGovernanceEntries(decision, riskResult, classification, directives) {
        const entries = [];
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
    buildTrace(decision, riskResult, classification, directives, auditEntries) {
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
    isCrossPlatformConsistent(directives) {
        if (directives.length === 0)
            return true;
        const firstAction = directives[0].action;
        return directives.every((directive) => directive.action === firstAction);
    }
    generateTamperEvidenceHash(decisionId, riskResult, classification, directives, entries) {
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

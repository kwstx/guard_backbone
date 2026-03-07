export enum EnforcementState {
    PENDING = 'PENDING',
    PRE_EXECUTION_PASSED = 'PRE_EXECUTION_PASSED',
    PRE_EXECUTION_FAILED = 'PRE_EXECUTION_FAILED',
    EXECUTING = 'EXECUTING',
    SUSPENDED = 'SUSPENDED',
    COMPLETED = 'COMPLETED',
    REMEDIATED = 'REMEDIATED',
    AUDIT_PASSED = 'AUDIT_PASSED',
    AUDIT_FAILED = 'AUDIT_FAILED'
}

export enum ViolationSeverity {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL'
}

export enum ViolationCategory {
    PERMISSION = 'PERMISSION',
    SCOPE = 'SCOPE',
    IMPACT = 'IMPACT',
    ANOMALY = 'ANOMALY',
    COMPLIANCE = 'COMPLIANCE'
}

export interface Violation {
    id: string;
    timestamp: Date;
    category: ViolationCategory;
    severity: ViolationSeverity;
    description: string;
    sourceLayer: string;
    metadata: Record<string, any>;
}

export type EnforcementLayer = 'PRE_EXECUTION' | 'IN_PROCESS' | 'POST_EXECUTION';
export type EnforcementDecisionOutcome =
    | 'PASS'
    | 'WARN'
    | 'HOLD'
    | 'BLOCK'
    | 'EXECUTE'
    | 'SUSPEND'
    | 'AUDIT_PASS'
    | 'AUDIT_FAIL'
    | 'REMEDIATE'
    | 'INTERVENE';

export interface EnforcementDecisionExplanation {
    decisionId: string;
    timestamp: Date;
    layer: EnforcementLayer;
    component: string;
    outcome: EnforcementDecisionOutcome;
    summary: string;
    rationale: string[];
    evidence: Record<string, unknown>;
}

export type SystemChangeType = 'CREATE' | 'UPDATE' | 'DELETE' | 'PERMISSION_CHANGE' | 'CONFIG_CHANGE';

export interface SystemChangeRecord {
    changeId: string;
    timestamp: Date;
    type: SystemChangeType;
    target: string;
    initiatedBy: string;
    reversible: boolean;
    unauthorized?: boolean;
    previousValue?: unknown;
    newValue?: unknown;
    metadata?: Record<string, unknown>;
}

export type RollbackTransactionStatus = 'PENDING' | 'APPLIED' | 'SKIPPED' | 'FAILED';

export interface RollbackTraceEntry {
    timestamp: Date;
    actor: string;
    status: RollbackTransactionStatus;
    detail: string;
    metadata?: Record<string, unknown>;
}

export interface RollbackTransaction {
    transactionId: string;
    actionId: string;
    changeId: string;
    target: string;
    rollbackAction: string;
    status: RollbackTransactionStatus;
    startedAt: Date;
    completedAt?: Date;
    trace: RollbackTraceEntry[];
}

export interface Stakeholder {
    id: string;
    role: string;
    contact: string;
}

export interface StakeholderNotification {
    notificationId: string;
    stakeholderId: string;
    channel: string;
    timestamp: Date;
    message: string;
    acknowledged: boolean;
}

export interface TrustRecalibration {
    previousCoefficient: number;
    updatedCoefficient: number;
    delta: number;
    reason: string;
    timestamp: Date;
}

export interface CooperativeIntelligenceMetrics {
    violationPressure: number; // 0.0 to 1.0
    stabilityAlignment: number; // 0.0 to 1.0
    repeatViolationRate: number; // 0.0 to 1.0
    influenceWeight: number; // 0.0 to 1.0
}

export interface TrustCalibrationPoint {
    horizon: string;
    trustCoefficient: number; // 0.0 to 1.0
}

export interface TrustCalibrationCurve {
    points: TrustCalibrationPoint[];
    slope: number;
    confidence: number; // 0.0 to 1.0
}

export interface SynergyDensityForecast {
    baselineDensity: number; // 0.0 to 1.0
    projectedDensity: number; // 0.0 to 1.0
    confidence: number; // 0.0 to 1.0
    horizon: string;
}

export interface TaskFormationProbabilityMap {
    autonomous: number;
    cooperative: number;
    supervised: number;
}

export interface StabilityFeedbackReport {
    generatedAt: Date;
    influenceWeightPrevious: number;
    influenceWeightUpdated: number;
    cooperativeMetrics: CooperativeIntelligenceMetrics;
    trustCalibrationCurve: TrustCalibrationCurve;
    synergyDensityForecasts: SynergyDensityForecast[];
    taskFormationProbabilitiesBefore: TaskFormationProbabilityMap;
    taskFormationProbabilitiesAfter: TaskFormationProbabilityMap;
    repeatedViolationCount: number;
}

export interface RemediationReport {
    actionId: string;
    generatedAt: Date;
    confirmedViolationIds: string[];
    rollbackTransactions: RollbackTransaction[];
    notifications: StakeholderNotification[];
    trustRecalibration: TrustRecalibration;
    stabilityFeedback?: StabilityFeedbackReport;
    safeRollback: boolean;
}

export interface DataAccessEvent {
    resource: string;
    operation: 'read' | 'write' | 'delete';
    recordCount?: number;
    sensitivity?: 'low' | 'medium' | 'high';
}

export interface CooperativeSignal {
    partnerId: string;
    stabilityScore: number; // 0.0 to 1.0
    conflictScore?: number; // 0.0 to 1.0
}

export interface ExecutionStep {
    stepId: string;
    timestamp?: Date;
    observedIntent?: string;
    authorityScopeUsed?: string[];
    apiCalls?: string[];
    dataAccess?: DataAccessEvent[];
    cooperativeSignals?: CooperativeSignal[];
}

export interface InProcessMonitorPolicy {
    declaredAuthorityScope: string[];
    allowedApis: string[];
    maxRecordsPerStep: number;
    maxCumulativeSensitiveReads: number;
    minCooperativeStability: number;
    maxCooperativeConflict: number;
}

export interface SynergyShift {
    component: string;
    previousSynergy: number;
    projectedSynergy: number;
    delta: number;
    reason: string;
}

export interface PropagationEffect {
    targetSystem: string;
    probability: number;
    impactMagnitude: number;
    trustWeight: number;
    description: string;
}

export interface PolicyForecast {
    policyId: string;
    complianceDelta: number; // -1.0 to 1.0
    forecastedOutcome: string;
}

export interface RiskProfile {
    overallRiskScore: number; // 0.0 to 1.0
    synergyShifts: SynergyShift[];
    propagationEffects: PropagationEffect[];
    policyForecasts: PolicyForecast[];
    realWorldConsequences: string[];
    recommendation: 'PROCEED' | 'HOLD' | 'BLOCK';
}

export interface BehaviorVector {
    intentDeviationRisk: number; // 0.0 to 1.0
    scopeDriftRisk: number; // 0.0 to 1.0
    apiNoveltyRisk: number; // 0.0 to 1.0
    sensitiveDataExposureRisk: number; // 0.0 to 1.0
    cooperativeInstabilityRisk: number; // 0.0 to 1.0
    dataVolumeRisk: number; // 0.0 to 1.0
}

export interface AnomalyToleranceThresholds {
    warn: number;
    slow: number;
    requireApproval: number;
    halt: number;
}

export type AnomalyMitigationAction = 'NONE' | 'WARN' | 'SLOW' | 'REQUIRE_APPROVAL' | 'HALT';

export interface ActionContext {
    actionId: string;
    agentId: string;
    intent: string;
    params: Record<string, any>;
    startTime?: Date;
    endTime?: Date;
    status: EnforcementState;
    violations: Violation[];
    interventions: Intervention[];
    riskProfile?: RiskProfile;
    predictedBehaviorVector?: BehaviorVector;
    executionTrace?: ExecutionStep[];
    anomalyApprovalGranted?: boolean;
    metadata?: Record<string, any>;
    systemChanges?: SystemChangeRecord[];
    stakeholders?: Stakeholder[];
    trustCoefficient?: number;
    remediationReport?: RemediationReport;
    cooperativeMetrics?: CooperativeIntelligenceMetrics;
    trustCalibrationCurve?: TrustCalibrationCurve;
    synergyDensityForecasts?: SynergyDensityForecast[];
    influenceWeight?: number;
    taskFormationProbabilities?: TaskFormationProbabilityMap;
    decisionExplanations?: EnforcementDecisionExplanation[];
}

export enum InterventionType {
    REDUCE_PERMISSIONS = 'REDUCE_PERMISSIONS',
    NARROW_SCOPE = 'NARROW_SCOPE',
    REQUIRE_VERIFICATION = 'REQUIRE_VERIFICATION',
    ESCALATE_TO_HUMAN = 'ESCALATE_TO_HUMAN',
    SUSPEND_EXECUTION = 'SUSPEND_EXECUTION',
    TERMINATE_SESSION = 'TERMINATE_SESSION'
}

export interface Intervention {
    id: string;
    timestamp: Date;
    type: InterventionType;
    description: string;
    reason: string;
    severity: ViolationSeverity;
    applied: boolean;
    metadata: Record<string, any>;
}

export interface HistoricalOutcome {
    actionId: string;
    timestamp: Date;
    violationsDetected: Violation[];
    interventionsApplied: Intervention[];
    realWorldImpact: number; // 0.0 (good) to 1.0 (disastrous)
    isFalsePositive: boolean;
    wasUnderRestricted: boolean; // True if we missed a violation (false negative)
    wasOverRestricted: boolean; // True if we blocked a valid action (false positive/over-sensitive)
}

export interface ThresholdAdaptationProfile {
    riskTolerance: number; // 0.1 to 2.0 (multiplier for risk sensitivity)
    anomalySensitivity: number; // 0.1 to 2.0 (multiplier for anomaly detection sensitivity)
    precisionWeight: number; // 0.0 to 1.0 (how much to favor precision over recall)
    lastAdaptation: Date;
}

export interface ThresholdAdaptationReport {
    previousProfile: ThresholdAdaptationProfile;
    updatedProfile: ThresholdAdaptationProfile;
    adaptationReason: string;
    metrics: {
        falsePositiveRate: number;
        missedViolationRate: number;
        averageImpact: number;
    };
}

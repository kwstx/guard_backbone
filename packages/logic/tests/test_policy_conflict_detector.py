from datetime import datetime

from actionable_logic.enforcement.policy_conflict_detector import ConflictSeverity, ConflictType, PolicyConflictDetector
from actionable_logic.enforcement.workflow import create_enforced_agent
from actionable_logic.live_update.engine import LiveUpdateEngine
from actionable_logic.models.policy_schema import ConditionOperator, LogicalCondition, PolicyDomain, PolicyScope, StructuredPolicy
from actionable_logic.repository.policy_repository import PolicyRepository


def _policy(
    policy_id: str,
    domain: PolicyDomain,
    conditions: list[LogicalCondition],
    instructions: list[str],
    compliance_type: str | None = None,
) -> StructuredPolicy:
    return StructuredPolicy(
        policy_id=policy_id,
        title=policy_id,
        version="1.0.0",
        domain=domain,
        scope=PolicyScope.GLOBAL,
        effective_date=datetime.utcnow(),
        compliance_type=compliance_type,
        conditions=conditions,
        instructions=instructions,
        raw_source=f"source-{policy_id}",
        rationale=f"rationale-{policy_id}",
    )


def test_detects_repository_contradictions_and_prioritizes_legal_and_safety():
    repo = PolicyRepository(db_url="sqlite:///:memory:")
    safety = _policy(
        "POL-SEC",
        PolicyDomain.SECURITY,
        [LogicalCondition(parameter="amount", operator=ConditionOperator.GT, value=1000)],
        ["Escalate transactions above 1000"],
    )
    legal = _policy(
        "POL-LEGAL",
        PolicyDomain.LEGAL,
        [LogicalCondition(parameter="amount", operator=ConditionOperator.LT, value=500)],
        ["Block transactions below 500 for audit mismatch"],
        compliance_type="SOX",
    )
    repo.save_policy(safety)
    repo.save_policy(legal)

    detector = PolicyConflictDetector(repository=repo)
    conflicts = detector.scan_once()

    assert len(conflicts) == 1
    conflict = conflicts[0]
    assert conflict.conflict_type == ConflictType.CONTRADICTORY_RULE
    assert conflict.severity == ConflictSeverity.SAFETY_CRITICAL
    assert "manual compliance review" in " ".join(conflict.resolution_suggestions)
    assert detector.get_audit_log(limit=1)[0].conflict_id == conflict.conflict_id


def test_detects_overlapping_workflow_enforcement_and_includes_workflow_scope():
    repo = PolicyRepository(db_url="sqlite:///:memory:")
    workflow = create_enforced_agent("wf-risk")
    overlap_left = _policy(
        "POL-A",
        PolicyDomain.GOVERNANCE,
        [LogicalCondition(parameter="resource", operator=ConditionOperator.EQ, value="pii")],
        ["Log accesses to pii resources"],
    )
    overlap_right = _policy(
        "POL-B",
        PolicyDomain.OPERATIONS,
        [LogicalCondition(parameter="resource", operator=ConditionOperator.EQ, value="pii")],
        ["Route pii actions through review queue"],
    )
    workflow.apply_policy_update(overlap_left)
    workflow.apply_policy_update(overlap_right)

    live_engine = LiveUpdateEngine()
    live_engine.register_workflow("wf-risk", workflow)
    detector = PolicyConflictDetector(repository=repo, workflow_provider=live_engine)

    conflicts = detector.scan_once()
    overlap_conflicts = [c for c in conflicts if c.conflict_type == ConflictType.OVERLAPPING_ENFORCEMENT]

    assert len(overlap_conflicts) == 1
    assert overlap_conflicts[0].workflow_id == "wf-risk"
    assert "workflow 'wf-risk'" in " ".join(overlap_conflicts[0].resolution_suggestions)


def test_audit_log_file_is_written_for_all_detected_conflicts(tmp_path):
    repo = PolicyRepository(db_url="sqlite:///:memory:")
    p1 = _policy(
        "POL-1",
        PolicyDomain.LEGAL,
        [LogicalCondition(parameter="score", operator=ConditionOperator.EQ, value=10)],
        ["Rule 1"],
        compliance_type="GDPR",
    )
    p2 = _policy(
        "POL-2",
        PolicyDomain.GOVERNANCE,
        [LogicalCondition(parameter="score", operator=ConditionOperator.EQ, value=20)],
        ["Rule 2"],
    )
    repo.save_policy(p1)
    repo.save_policy(p2)
    log_path = tmp_path / "audit" / "policy_conflicts.jsonl"

    detector = PolicyConflictDetector(repository=repo, audit_log_path=str(log_path))
    conflicts = detector.scan_once()

    assert len(conflicts) == 1
    assert log_path.exists()
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    assert "POL-1" in lines[0] and "POL-2" in lines[0]

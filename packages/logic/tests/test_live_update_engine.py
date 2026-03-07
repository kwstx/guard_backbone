import threading
import time

from actionable_logic.live_update.engine import (
    AtomicWorkflowStore,
    InMemoryPolicyChangeSource,
    LiveUpdateEngine,
    PolicyChange,
)


def test_detects_policy_diff_and_skips_noop_recompile():
    engine = LiveUpdateEngine(poll_interval_seconds=0.1)
    first = engine.apply_change(
        PolicyChange(
            policy_id="reg-1",
            raw_text="All agents must maintain trust score above 0.7.",
            source="external_regulatory_feed",
        )
    )
    second = engine.apply_change(
        PolicyChange(
            policy_id="reg-1",
            raw_text="All agents must maintain trust score above 0.7.",
            source="external_regulatory_feed",
        )
    )

    assert first.changed is True
    assert second.changed is False
    policy = engine.get_policy("reg-1")
    assert policy is not None
    assert policy.version == "1.0.0"


def test_recompiles_changed_policy_and_pushes_to_subscribed_workflows():
    engine = LiveUpdateEngine()
    workflow = AtomicWorkflowStore()
    engine.register_workflow("wf-risk", workflow, policy_ids={"risk-policy"})

    v1 = engine.apply_change(
        PolicyChange(
            policy_id="risk-policy",
            raw_text="Security access requires trust score >= 0.8.",
            source="internal_policy_repo",
        )
    )
    v2 = engine.apply_change(
        PolicyChange(
            policy_id="risk-policy",
            raw_text="Security access requires trust score >= 0.85 and manager approval.",
            source="internal_policy_repo",
        )
    )

    assert v1.changed is True
    assert v2.changed is True
    assert "wf-risk" in v2.affected_workflows
    policy = engine.get_policy("risk-policy")
    assert policy is not None
    assert policy.version == "1.0.1"
    execution = workflow.execute({"request": "access"})
    assert execution["active_policy_ids"] == ["risk-policy"]


def test_source_monitoring_applies_changes_without_workflow_downtime():
    source = InMemoryPolicyChangeSource()
    engine = LiveUpdateEngine(poll_interval_seconds=0.05)
    workflow = AtomicWorkflowStore()
    engine.register_workflow("wf-live", workflow)
    engine.add_source(source)

    errors: list[Exception] = []
    observed_counts: list[int] = []
    keep_running = True

    def _runner() -> None:
        while keep_running:
            try:
                result = workflow.execute({"action": "tick"})
                observed_counts.append(result["policy_count"])
            except Exception as exc:  # pragma: no cover - defensive
                errors.append(exc)
                break
            time.sleep(0.005)

    worker = threading.Thread(target=_runner, daemon=True)
    worker.start()

    engine.start()
    source.push_change(
        policy_id="reg-live",
        raw_text="Transactions above 10000 require review.",
        source="external_regulatory_feed",
    )
    source.push_change(
        policy_id="reg-live",
        raw_text="Transactions above 9000 require review and audit trail.",
        source="external_regulatory_feed",
    )
    source.push_change(
        policy_id="internal-live",
        raw_text="Team leads must approve deployments after QA sign-off.",
        source="internal_policy_repo",
    )
    time.sleep(0.25)
    engine.stop()
    keep_running = False
    worker.join(timeout=1.0)

    assert not errors
    assert any(count > 0 for count in observed_counts)
    policies = engine.list_policies()
    assert set(policies.keys()) == {"reg-live", "internal-live"}

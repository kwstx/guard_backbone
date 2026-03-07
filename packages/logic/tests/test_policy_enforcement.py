import pytest
from datetime import datetime
from actionable_logic.models.policy_schema import (
    StructuredPolicy, PolicyDomain, PolicyScope, 
    LogicalCondition, ConditionOperator, ActionTrigger
)
from actionable_logic.enforcement.engine import PolicyEnforcer
from actionable_logic.enforcement.workflow import create_enforced_agent

def test_policy_enforcement_logic():
    # 1. Create a policy
    policy = StructuredPolicy(
        policy_id="P-001",
        title="High Value Transaction Policy",
        domain=PolicyDomain.FINANCE,
        scope=PolicyScope.GLOBAL,
        raw_source="If amount > 1000, require extra logging.",
        rationale="Risk mitigation",
        instructions=["Log to security channel", "Check agent authorization"],
        conditions=[
            LogicalCondition(
                parameter="amount",
                operator=ConditionOperator.GT,
                value=1000
            )
        ],
        triggers=[
            ActionTrigger(
                trigger_type="on_activation",
                action_name="extra_logging",
                parameters={"level": "CRITICAL"}
            )
        ]
    )

    enforcer = PolicyEnforcer(policies=[policy])

    # 2. Test below threshold
    state_ok = {"amount": 500}
    results_ok = enforcer.evaluate(state_ok)
    assert results_ok[0].metadata["status"] == "inactive"
    assert len(results_ok[0].triggered_actions) == 0

    # 3. Test above threshold
    state_trigger = {"amount": 1500}
    results_trigger = enforcer.evaluate(state_trigger)
    assert results_trigger[0].metadata["status"] == "active"
    assert len(results_trigger[0].triggered_actions) == 1
    assert results_trigger[0].triggered_actions[0].action_name == "extra_logging"
    assert "Log to security channel" in results_trigger[0].instructions

def test_workflow_injection():
    # Create an agent
    ctx = {"agent_id": "agent-007", "dept": "finance"}
    agent = create_enforced_agent("finance-workflow", context=ctx)

    # Create and apply a policy
    policy = StructuredPolicy(
        policy_id="P-LIMIT",
        title="Spending Limit",
        domain=PolicyDomain.FINANCE,
        scope=PolicyScope.TEAM,
        raw_source="Usage > 80% requires warning.",
        rationale="Budget control",
        instructions=["Issue warning", "Minimize further spending"],
        conditions=[
            LogicalCondition(
                parameter="usage_percent",
                operator=ConditionOperator.GE,
                value=80
            )
        ]
    )
    
    agent.apply_policy_update(policy)

    # Execute workflow logic
    payload = {"action": "purchase_server", "usage_percent": 85}
    result = agent.execute(payload)

    assert result["status"] == "success"
    assert "Issue warning" in result["constraints_applied"]
    assert "Minimize further spending" in result["constraints_applied"]
    assert result["agent_context"]["agent_id"] == "agent-007"

def test_regex_matching():
    policy = StructuredPolicy(
        policy_id="P-REGEX",
        title="Banned Word Check",
        domain=PolicyDomain.ETHICS,
        scope=PolicyScope.GLOBAL,
        raw_source="No offensive words in logs.",
        rationale="Compliance",
        instructions=["Sanitize output"],
        conditions=[
            LogicalCondition(
                parameter="log_content",
                operator=ConditionOperator.MATCHES,
                value=r"badword\d+"
            )
        ]
    )
    
    enforcer = PolicyEnforcer(policies=[policy])
    
    assert enforcer.evaluate({"log_content": "everything fine"})[0].metadata["status"] == "inactive"
    assert enforcer.evaluate({"log_content": "error badword123 happens"})[0].metadata["status"] == "active"

if __name__ == "__main__":
    pytest.main([__file__])

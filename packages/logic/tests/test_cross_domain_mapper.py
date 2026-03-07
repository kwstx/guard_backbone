from datetime import datetime

from actionable_logic.models.policy_schema import PolicyDomain, PolicyScope, StructuredPolicy
from actionable_logic.translator.cross_domain_mapper import ComplianceAction, CrossDomainMapper, OperationalContext


def _privacy_policy() -> StructuredPolicy:
    return StructuredPolicy(
        policy_id="privacy-001",
        title="Privacy-first data handling",
        version="1.0.0",
        domain=PolicyDomain.LEGAL,
        scope=PolicyScope.GLOBAL,
        effective_date=datetime.utcnow(),
        raw_source="All personal and patient data must be processed with privacy safeguards.",
        rationale="Baseline privacy requirement across all operations.",
        instructions=[
            "Collect only necessary data.",
            "Enforce access restrictions.",
        ],
        conditions=[],
        triggers=[],
        exceptions=[],
    )


def test_privacy_rule_maps_to_gdpr_and_hipaa_actions():
    mapper = CrossDomainMapper()
    context = OperationalContext(
        industry="healthcare",
        regions=["EU", "US"],
        data_categories=["phi", "personal_data"],
    )

    result = mapper.map_policy(_privacy_policy(), context)

    assert result.policy_id == "privacy-001"
    assert result.selected_frameworks == ["GDPR", "HIPAA"]
    action_frameworks = {action.framework for action in result.generated_actions}
    assert action_frameworks == {"GDPR", "HIPAA"}
    assert any(action.action_name == "enforce_data_minimization_retention" for action in result.generated_actions)
    assert any(action.action_name == "apply_minimum_necessary_standard" for action in result.generated_actions)


def test_conflict_resolution_selects_stricter_action_for_overlaps():
    mapper = CrossDomainMapper()
    context = OperationalContext(industry="healthcare", regions=["EU"])
    actions = [
        ComplianceAction(
            framework="GDPR",
            action_name="enforce_data_minimization_retention",
            description="GDPR retention ceiling",
            parameters={"max_retention_days": 365},
            mandatory=True,
            priority=92,
            strictness=95,
            conflict_key="data_retention",
        ),
        ComplianceAction(
            framework="HIPAA",
            action_name="enforce_record_retention_for_phi",
            description="HIPAA retention window",
            parameters={"max_retention_days": 2190},
            mandatory=True,
            priority=89,
            strictness=70,
            conflict_key="data_retention",
        ),
    ]

    resolved, decisions = mapper.resolve_conflicts(actions, context)

    assert len(resolved) == 1
    assert resolved[0].framework == "GDPR"
    assert len(decisions) == 1
    assert decisions[0].conflict_key == "data_retention"
    assert decisions[0].selected_action.framework == "GDPR"
    assert len(decisions[0].dropped_actions) == 1

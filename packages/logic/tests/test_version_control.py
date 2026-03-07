import pytest
from actionable_logic.version_control.engine import VersionControlEngine
from actionable_logic.repository.policy_repository import PolicyRepository
from actionable_logic.models.policy_schema import StructuredPolicy, PolicyDomain, PolicyScope, LogicalCondition, ConditionOperator
from actionable_logic.repository.models import DeploymentStatus, AdoptionStatus

@pytest.fixture
def vc_engine():
    # Use in-memory database for testing
    db_url = "sqlite:///:memory:"
    engine = VersionControlEngine(db_url=db_url)
    return engine

def test_deployment_lifecycle(vc_engine):
    # 1. Create a policy
    policy = StructuredPolicy(
        policy_id="POL-001",
        title="Privacy Policy",
        version="1.0.0",
        domain=PolicyDomain.LEGAL,
        scope=PolicyScope.GLOBAL,
        raw_source="Source text",
        rationale="Legal requirement",
        instructions=["Must obtain consent"]
    )
    vc_engine.repository.save_policy(policy)

    # 2. Prepare deployment (Staging)
    dep_id = vc_engine.prepare_deployment("POL-001", "1.0.0", environment="staging")
    assert dep_id is not None
    
    trail = vc_engine.get_audit_trail("POL-001")
    assert len(trail) == 1
    assert trail[0]["status"] == DeploymentStatus.STAGING.value

    # 3. Promote to Production
    vc_engine.promote_to_production(dep_id)
    trail = vc_engine.get_audit_trail("POL-001")
    assert trail[0]["status"] == DeploymentStatus.PRODUCTION.value
    assert trail[0]["deployed_at"] is not None

def test_rollback(vc_engine):
    # Create two versions of a policy
    p1 = StructuredPolicy(
        policy_id="POL-001", title="V1", version="1.0.0",
        domain=PolicyDomain.LEGAL, scope=PolicyScope.GLOBAL,
        raw_source="S1", rationale="R1", instructions=["I1"]
    )
    p2 = StructuredPolicy(
        policy_id="POL-001", title="V2", version="2.0.0",
        domain=PolicyDomain.LEGAL, scope=PolicyScope.GLOBAL,
        raw_source="S2", rationale="R2", instructions=["I2"]
    )
    vc_engine.repository.save_policy(p1)
    vc_engine.repository.save_policy(p2)

    # Deploy V1 to production
    d1 = vc_engine.prepare_deployment("POL-001", "1.0.0", environment="production")
    vc_engine.promote_to_production(d1)

    # Deploy V2 to production
    d2 = vc_engine.prepare_deployment("POL-001", "2.0.0", environment="production")
    vc_engine.promote_to_production(d2)

    # Verify V2 is active
    trail = vc_engine.get_audit_trail("POL-001")
    assert trail[0]["version"] == "2.0.0"
    assert trail[0]["status"] == DeploymentStatus.PRODUCTION.value
    assert trail[1]["status"] == DeploymentStatus.ARCHIVED.value

    # Rollback to V1
    rb_id = vc_engine.rollback("POL-001", environment="production")
    assert rb_id is not None

    trail = vc_engine.get_audit_trail("POL-001")
    assert trail[0]["version"] == "1.0.0"
    assert trail[0]["status"] == DeploymentStatus.PRODUCTION.value
    assert trail[1]["version"] == "2.0.0"
    assert trail[1]["status"] == DeploymentStatus.ROLLED_BACK.value

def test_adoption_tracking_and_analytics(vc_engine):
    # Create policy
    policy = StructuredPolicy(
        policy_id="POL-001", title="Compliance", version="1.0.0",
        domain=PolicyDomain.SECURITY, scope=PolicyScope.GLOBAL,
        raw_source="S1", rationale="R1", instructions=["I1"]
    )
    vc_engine.repository.save_policy(policy)

    # Track adoption for multiple agents
    vc_engine.track_adoption("agent-1", "POL-001", "1.0.0", compliance_score={"overall": 0.95})
    vc_engine.track_adoption("agent-2", "POL-001", "1.0.0", compliance_score={"overall": 0.85})
    
    # Track update for agent-1
    vc_engine.track_adoption("agent-1", "POL-001", "1.1.0", compliance_score={"overall": 1.0})

    # Check analytics for 1.0.0
    analytics = vc_engine.get_adoption_analytics("POL-001", "1.0.0")
    # Only agent-2 is still ACTIVE on 1.0.0
    assert analytics["adoption_count"] == 1
    assert analytics["compliance_impact"] == 0.85

    # Check agent-1 status
    compliance = vc_engine.list_agent_policy_compliance("agent-1")
    assert len(compliance) == 1
    assert compliance[0]["version"] == "1.1.0"

def test_compliance_impact_comparison(vc_engine):
    # Track adoptions for two versions
    vc_engine.track_adoption("a1", "POL-X", "1.0", compliance_score={"overall": 0.7})
    vc_engine.track_adoption("a2", "POL-X", "1.0", compliance_score={"overall": 0.8})
    
    vc_engine.track_adoption("a1", "POL-X", "2.0", compliance_score={"overall": 0.9})
    vc_engine.track_adoption("a2", "POL-X", "2.0", compliance_score={"overall": 1.0})

    comparison = vc_engine.compare_compliance_impact("POL-X", "1.0", "2.0")
    assert comparison["old_compliance"] == 0.75
    assert comparison["new_compliance"] == 0.95
    assert comparison["compliance_delta"] == pytest.approx(0.2)
    assert comparison["impact_direction"] == "improved"

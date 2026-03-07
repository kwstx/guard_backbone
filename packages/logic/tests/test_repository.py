import pytest
import os
from datetime import datetime
from actionable_logic.repository.policy_repository import PolicyRepository
from actionable_logic.models.policy_schema import StructuredPolicy, PolicyDomain, PolicyScope, LogicalCondition, ConditionOperator

@pytest.fixture
def repo():
    # Use in-memory database for testing to avoid file locking issues on Windows
    repository = PolicyRepository(db_url="sqlite:///:memory:")
    yield repository

def test_save_and_get_policy(repo):
    policy = StructuredPolicy(
        policy_id="POL-001",
        title="Consent Policy",
        version="1.0.0",
        domain=PolicyDomain.LEGAL,
        scope=PolicyScope.GLOBAL,
        industry="Healthcare",
        compliance_type="GDPR",
        raw_source="Users must consent to data processing.",
        rationale="Requirement for legal processing.",
        instructions=["Verify consent flag before processing."]
    )
    
    repo.save_policy(policy)
    retrieved = repo.get_policy("POL-001")
    
    assert retrieved is not None
    assert retrieved.title == "Consent Policy"
    assert retrieved.industry == "Healthcare"
    assert retrieved.compliance_type == "GDPR"

def test_versioning(repo):
    p1 = StructuredPolicy(
        policy_id="POL-001",
        title="Consent Policy v1",
        version="1.0.0",
        domain=PolicyDomain.LEGAL,
        scope=PolicyScope.GLOBAL,
        raw_source="Source v1",
        rationale="Rat v1",
        instructions=["Inst v1"]
    )
    repo.save_policy(p1)
    
    p2 = StructuredPolicy(
        policy_id="POL-001",
        title="Consent Policy v2",
        version="1.1.0",
        domain=PolicyDomain.LEGAL,
        scope=PolicyScope.GLOBAL,
        raw_source="Source v2",
        rationale="Rat v2",
        instructions=["Inst v2"]
    )
    repo.save_policy(p2)
    
    latest = repo.get_policy("POL-001")
    assert latest.version == "1.1.0"
    
    v1 = repo.get_policy("POL-001", version="1.0.0")
    assert v1.version == "1.0.0"

def test_querying(repo):
    repo.save_policy(StructuredPolicy(
        policy_id="P1", title="T1", domain=PolicyDomain.FINANCE, scope=PolicyScope.GLOBAL,
        industry="Banking", compliance_type="SEC", raw_source="S1", rationale="R1", instructions=["I1"]
    ))
    repo.save_policy(StructuredPolicy(
        policy_id="P2", title="T2", domain=PolicyDomain.LEGAL, scope=PolicyScope.GLOBAL,
        industry="Healthcare", compliance_type="HIPAA", raw_source="S2", rationale="R2", instructions=["I2"]
    ))
    
    banking_policies = repo.list_policies(industry="Banking")
    assert len(banking_policies) == 1
    assert banking_policies[0].policy_id == "P1"
    
    legal_policies = repo.list_policies(domain=PolicyDomain.LEGAL.value)
    assert len(legal_policies) == 1
    assert legal_policies[0].policy_id == "P2"

def test_template_cloning(repo):
    template = StructuredPolicy(
        policy_id="TMPL-AUTH",
        title="Base Auth Template",
        version="1.0.0",
        domain=PolicyDomain.SECURITY,
        scope=PolicyScope.GLOBAL,
        is_template=True,
        industry="Generic",
        raw_source="Users must be authenticated.",
        rationale="Security baseline.",
        instructions=["Check JWT token."]
    )
    repo.save_policy(template)
    
    # Clone for a specific client in finance
    cloned = repo.clone_template(
        "TMPL-AUTH", 
        "POL-FIN-AUTH", 
        {"industry": "Finance", "compliance_type": "SOX", "title": "Finance Auth Policy"}
    )
    
    assert cloned.policy_id == "POL-FIN-AUTH"
    assert cloned.industry == "Finance"
    assert cloned.compliance_type == "SOX"
    assert cloned.is_template is False
    assert cloned.template_id == "TMPL-AUTH"
    assert cloned.instructions == ["Check JWT token."]

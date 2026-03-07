import pytest
from actionable_logic.repository.policy_repository import PolicyRepository
from actionable_logic.live_update.engine import LiveUpdateEngine
from actionable_logic.extensibility.template_module import TemplateExtensibilityModule
from actionable_logic.models.policy_schema import StructuredPolicy, PolicyDomain, PolicyScope

@pytest.fixture
def extensibility_module():
    repo = PolicyRepository(db_url="sqlite:///:memory:")
    engine = LiveUpdateEngine()
    module = TemplateExtensibilityModule(repo, engine)
    return module

def test_create_valid_template(extensibility_module):
    template = StructuredPolicy(
        policy_id="TMPL-SEC-001",
        title="Security Base Template",
        domain=PolicyDomain.SECURITY,
        scope=PolicyScope.GLOBAL,
        is_template=True,
        raw_source="Default security rules.",
        rationale="Base security",
        instructions=["Initial check"],
        compliance_type="General"
    )
    
    created = extensibility_module.create_template(template)
    
    assert created.is_template is True
    # Check if saved in repo
    assert extensibility_module.repository.get_policy("TMPL-SEC-001") is not None
    # Check if integrated in live engine
    assert extensibility_module.live_update_engine.get_policy("TMPL-SEC-001") is not None

def test_validation_failure_forbidden_keyword(extensibility_module):
    template = StructuredPolicy(
        policy_id="TMPL-BAD",
        title="Bypass Security", # Contains 'bypass'
        domain=PolicyDomain.SECURITY,
        scope=PolicyScope.GLOBAL,
        is_template=True,
        raw_source="Source",
        rationale="Rat",
        instructions=["Inst"]
    )
    
    with pytest.raises(ValueError) as excinfo:
        extensibility_module.create_template(template)
    assert "forbidden keyword" in str(excinfo.value)

def test_validation_failure_missing_legal_compliance(extensibility_module):
    template = StructuredPolicy(
        policy_id="TMPL-LEGAL-BAD",
        title="Legal Template",
        domain=PolicyDomain.LEGAL,
        scope=PolicyScope.GLOBAL,
        is_template=True,
        raw_source="Source",
        rationale="Rat",
        instructions=["Inst"]
        # compliance_type is missing
    )
    
    with pytest.raises(ValueError) as excinfo:
        extensibility_module.create_template(template)
    assert "must specify a compliance_type" in str(excinfo.value)

def test_conflict_detection(extensibility_module):
    template1 = StructuredPolicy(
        policy_id="TMPL-DUP",
        title="Duplicate Template",
        domain=PolicyDomain.GOVERNANCE,
        scope=PolicyScope.GLOBAL,
        is_template=True,
        raw_source="Source 1",
        rationale="Rat 1",
        instructions=["Inst 1"]
    )
    extensibility_module.create_template(template1)
    
    template2 = StructuredPolicy(
        policy_id="TMPL-DUP-OTHER",
        title="Duplicate Template", # Same title
        domain=PolicyDomain.GOVERNANCE,
        scope=PolicyScope.GLOBAL,
        is_template=True,
        raw_source="Source 2",
        rationale="Rat 2",
        instructions=["Inst 2"]
    )
    
    with pytest.raises(ValueError) as excinfo:
        extensibility_module.create_template(template2)
    assert "already exists" in str(excinfo.value)

def test_customize_template(extensibility_module):
    # First create a template
    template = StructuredPolicy(
        policy_id="TMPL-AUTH",
        title="Auth Template",
        domain=PolicyDomain.SECURITY,
        scope=PolicyScope.GLOBAL,
        is_template=True,
        raw_source="Auth source",
        rationale="Auth rat",
        instructions=["Check Auth"]
    )
    extensibility_module.create_template(template)
    
    # Customize it
    customized = extensibility_module.customize_template(
        "TMPL-AUTH",
        "POL-FIN-AUTH",
        {"industry": "Finance", "compliance_type": "SOX", "title": "Finance Auth"}
    )
    
    assert customized.policy_id == "POL-FIN-AUTH"
    assert customized.is_template is False
    assert customized.industry == "Finance"
    assert extensibility_module.live_update_engine.get_policy("POL-FIN-AUTH") is not None

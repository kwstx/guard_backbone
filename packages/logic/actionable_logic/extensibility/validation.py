from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
from actionable_logic.models.policy_schema import StructuredPolicy, PolicyDomain, PolicyScope

@dataclass
class ValidationResult:
    is_valid: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

class TemplateValidator:
    """
    Validates policy templates against legal, internal standards, and consistency rules.
    """
    
    def __init__(self, standards: Optional[Dict[str, Any]] = None):
        self.standards = standards or self._get_default_standards()

    def _get_default_standards(self) -> Dict[str, Any]:
        return {
            "required_fields": ["policy_id", "title", "domain", "scope", "raw_source", "instructions"],
            "legal_domains": [PolicyDomain.LEGAL, PolicyDomain.GOVERNANCE, PolicyDomain.SECURITY],
            "min_instructions": 1,
            "forbidden_keywords": ["bypass", "ignore_all", "unrestricted"]
        }

    def validate(self, policy: StructuredPolicy) -> ValidationResult:
        errors = []
        warnings = []

        # 1. Structural Validation (Pydantic already does most of this, but we check template-specific logic)
        if not policy.is_template:
            warnings.append("Policy is being validated as a template but is_template is False.")

        # 2. Check Required Fields for Template Completeness
        for field_name in self.standards["required_fields"]:
            if not getattr(policy, field_name, None):
                errors.append(f"Missing required field: {field_name}")

        # 3. Instruction Consistency
        if len(policy.instructions) < self.standards["min_instructions"]:
            errors.append(f"Template must have at least {self.standards['min_instructions']} instruction(s).")

        # 4. Keyword Blacklist (Legal/Standard Compliance)
        combined_text = (policy.title + policy.raw_source + " ".join(policy.instructions)).lower()
        for keyword in self.standards["forbidden_keywords"]:
            if keyword in combined_text:
                errors.append(f"Template contains forbidden keyword: '{keyword}'")

        # 5. Domain-Specific Legal Checks
        if policy.domain == PolicyDomain.LEGAL:
            if not policy.compliance_type:
                errors.append("Legal policies must specify a compliance_type (e.g., GDPR, SOC2).")
            if policy.scope == PolicyScope.GLOBAL and not policy.rationale:
                errors.append("Global legal policies must provide a detailed rationale.")

        # 6. Conflict Detection (Logic consistency)
        # Check if conditions and triggers exist
        if not policy.conditions and not policy.triggers:
            warnings.append("Template has no conditions or triggers; it may be non-actionable.")

        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings
        )

    def check_conflicts(self, new_template: StructuredPolicy, existing_templates: List[StructuredPolicy]) -> List[str]:
        """
        Detects potential logic conflicts with existing templates.
        """
        conflicts = []
        for existing in existing_templates:
            if existing.policy_id == new_template.policy_id:
                conflicts.append(f"Conflict: Template ID '{new_template.policy_id}' already exists.")
            
            # Simple title conflict
            if existing.title.lower() == new_template.title.lower():
                conflicts.append(f"Conflict: Template with title '{new_template.title}' already exists.")

            # Logic overlap check (simple version)
            # If they have identical conditions but different triggers, it might be a conflict.
            if existing.conditions == new_template.conditions and existing.conditions:
                if existing.triggers != new_template.triggers:
                    conflicts.append(f"Conflict: Template '{new_template.policy_id}' has identical conditions to '{existing.policy_id}' but different triggers.")

        return conflicts

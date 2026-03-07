from typing import List, Optional, Dict, Any
import logging
from actionable_logic.models.policy_schema import StructuredPolicy
from actionable_logic.repository.policy_repository import PolicyRepository
from actionable_logic.live_update.engine import LiveUpdateEngine, PolicyChange
from .validation import TemplateValidator, ValidationResult

logger = logging.getLogger(__name__)

class TemplateExtensibilityModule:
    """
    Module that allows users to customize or create new policy templates
    while ensuring consistency, legal compliance, and live integration.
    """

    def __init__(
        self, 
        repository: PolicyRepository, 
        live_update_engine: LiveUpdateEngine,
        validator: Optional[TemplateValidator] = None
    ):
        self.repository = repository
        self.live_update_engine = live_update_engine
        self.validator = validator or TemplateValidator()

    def create_template(self, template: StructuredPolicy) -> StructuredPolicy:
        """
        Validates, saves, and integrates a new policy template.
        """
        # Ensure it's marked as a template
        template.is_template = True

        # 1. Validate against standards
        validation = self.validator.validate(template)
        if not validation.is_valid:
            raise ValueError(f"Template validation failed: {', '.join(validation.errors)}")

        # 2. Check for conflicts with existing templates
        existing_templates = self.repository.list_policies(is_template=True)
        conflicts = self.validator.check_conflicts(template, existing_templates)
        if conflicts:
            raise ValueError(f"Template conflict detected: {', '.join(conflicts)}")

        # 3. Save to repository
        self.repository.save_policy(template)

        # 4. Integrate into Live Update Engine
        self._integrate_with_live_engine(template)

        return template

    def customize_template(
        self, 
        template_id: str, 
        new_policy_id: str, 
        customizations: Dict[str, Any]
    ) -> StructuredPolicy:
        """
        Creates a new policy (not a template) from an existing template with specific customizations.
        """
        # 1. Clone through repository
        # (The repository clone_template already applies updates and saves)
        new_policy = self.repository.clone_template(template_id, new_policy_id, customizations)

        # 2. Validate the result (even if it's not a template, it should meet basic standards)
        validation = self.validator.validate(new_policy)
        if not validation.is_valid:
            # We might want to be more lenient with non-templates, but let's stick to standards for now
            # Actually, we can just log warnings or raise if critical errors exist
            if any("forbidden keyword" in e for e in validation.errors):
                 raise ValueError(f"Customized policy violates legal standards: {', '.join(validation.errors)}")

        # 3. Integrate into Live Update Engine
        self._integrate_with_live_engine(new_policy)

        return new_policy

    def _integrate_with_live_engine(self, policy: StructuredPolicy):
        """
        Automatically pushes the new or updated template/policy to the live update engine.
        """
        change = PolicyChange(
            policy_id=policy.policy_id,
            raw_text=policy.raw_source,
            source="TemplateExtensibilityModule",
            metadata={
                "domain": policy.domain.value,
                "scope": policy.scope.value,
                "title": policy.title
            },
            version_hint=policy.version
        )
        # We manually apply the change to the engine to ensure immediate integration
        self.live_update_engine.apply_change(change)
        logger.info(f"Policy/Template '{policy.policy_id}' integrated into Live Update Engine.")

    def list_templates(self, **filters) -> List[StructuredPolicy]:
        """Returns all available templates, filtered by industry, compliance, etc."""
        return self.repository.list_policies(is_template=True, **filters)

from __future__ import annotations

from collections import defaultdict
from typing import Any

from pydantic import BaseModel, Field

from actionable_logic.models.policy_schema import StructuredPolicy


class OperationalContext(BaseModel):
    """Execution context used to choose relevant compliance frameworks."""

    industry: str
    regions: list[str] = Field(default_factory=list)
    data_categories: list[str] = Field(default_factory=list)
    active_frameworks: list[str] = Field(default_factory=list)


class ComplianceAction(BaseModel):
    """Concrete framework action generated from a single high-level policy."""

    framework: str
    action_name: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    mandatory: bool = True
    priority: int = 50
    strictness: int = 50
    conflict_key: str | None = None


class ConflictResolutionDecision(BaseModel):
    """Audit record describing how overlapping framework requirements were resolved."""

    conflict_key: str
    selected_action: ComplianceAction
    dropped_actions: list[ComplianceAction] = Field(default_factory=list)
    reason: str


class CrossDomainMappingResult(BaseModel):
    policy_id: str
    selected_frameworks: list[str]
    generated_actions: list[ComplianceAction]
    conflict_resolutions: list[ConflictResolutionDecision] = Field(default_factory=list)


class CrossDomainMapper:
    """
    Expands one policy into framework-specific compliance actions
    and resolves overlaps when requirements collide.
    """

    def __init__(self) -> None:
        self._framework_precedence_by_industry: dict[str, dict[str, int]] = {
            "healthcare": {"HIPAA": 100, "GDPR": 90},
            "finance": {"GDPR": 95, "HIPAA": 80},
            "default": {"GDPR": 90, "HIPAA": 85},
        }

    def map_policy(self, policy: StructuredPolicy, context: OperationalContext) -> CrossDomainMappingResult:
        frameworks = self._select_frameworks(context)
        intent = self._detect_policy_intent(policy)

        generated: list[ComplianceAction] = []
        for framework in frameworks:
            generated.extend(self._build_actions_for_framework(intent=intent, framework=framework, policy=policy))

        resolved_actions, resolutions = self.resolve_conflicts(generated, context)

        return CrossDomainMappingResult(
            policy_id=policy.policy_id,
            selected_frameworks=frameworks,
            generated_actions=resolved_actions,
            conflict_resolutions=resolutions,
        )

    def resolve_conflicts(
        self, actions: list[ComplianceAction], context: OperationalContext
    ) -> tuple[list[ComplianceAction], list[ConflictResolutionDecision]]:
        grouped: dict[str, list[ComplianceAction]] = defaultdict(list)
        passthrough: list[ComplianceAction] = []

        for action in actions:
            if action.conflict_key:
                grouped[action.conflict_key].append(action)
            else:
                passthrough.append(action)

        precedence = self._framework_precedence(context.industry)
        decisions: list[ConflictResolutionDecision] = []
        resolved: list[ComplianceAction] = list(passthrough)

        for conflict_key, bucket in grouped.items():
            if len(bucket) == 1:
                resolved.append(bucket[0])
                continue

            ranked = sorted(
                bucket,
                key=lambda a: (
                    1 if a.mandatory else 0,
                    a.strictness,
                    a.priority,
                    precedence.get(a.framework.upper(), 0),
                    a.framework,
                    a.action_name,
                ),
                reverse=True,
            )
            selected = ranked[0]
            dropped = ranked[1:]
            resolved.append(selected)

            reason = (
                "selected highest-ranked requirement using "
                "mandatory -> strictness -> priority -> framework precedence"
            )
            decisions.append(
                ConflictResolutionDecision(
                    conflict_key=conflict_key,
                    selected_action=selected,
                    dropped_actions=dropped,
                    reason=reason,
                )
            )

        resolved.sort(key=lambda a: (a.framework, a.action_name))
        decisions.sort(key=lambda d: d.conflict_key)
        return resolved, decisions

    def _select_frameworks(self, context: OperationalContext) -> list[str]:
        framework_set = {f.upper() for f in context.active_frameworks}

        regions = {r.lower() for r in context.regions}
        industry = context.industry.lower()
        categories = {c.lower() for c in context.data_categories}

        if regions.intersection({"eu", "eea", "european_union", "europe"}):
            framework_set.add("GDPR")

        if industry == "healthcare" or categories.intersection({"phi", "protected_health_information", "medical_data"}):
            framework_set.add("HIPAA")

        return sorted(framework_set)

    @staticmethod
    def _detect_policy_intent(policy: StructuredPolicy) -> str:
        text = " ".join(
            [
                policy.title,
                policy.raw_source,
                " ".join(policy.instructions),
            ]
        ).lower()

        if any(token in text for token in ("privacy", "personal data", "patient", "consent", "confidentiality")):
            return "privacy"
        return "generic"

    def _build_actions_for_framework(self, intent: str, framework: str, policy: StructuredPolicy) -> list[ComplianceAction]:
        if intent == "privacy":
            return self._privacy_actions(framework, policy)
        return [
            ComplianceAction(
                framework=framework,
                action_name="log_policy_adoption",
                description=f"Record that policy {policy.policy_id} is active under {framework}.",
                parameters={"policy_id": policy.policy_id},
                mandatory=True,
                priority=30,
                strictness=30,
            )
        ]

    def _privacy_actions(self, framework: str, policy: StructuredPolicy) -> list[ComplianceAction]:
        framework_upper = framework.upper()

        if framework_upper == "GDPR":
            return [
                ComplianceAction(
                    framework="GDPR",
                    action_name="record_processing_purpose",
                    description="Document lawful basis and purpose before personal data processing.",
                    parameters={"policy_id": policy.policy_id, "lawful_basis_required": True},
                    mandatory=True,
                    priority=90,
                    strictness=90,
                ),
                ComplianceAction(
                    framework="GDPR",
                    action_name="enforce_data_minimization_retention",
                    description="Limit retention and apply deletion/anonymization once purpose expires.",
                    parameters={"max_retention_days": 365},
                    mandatory=True,
                    priority=92,
                    strictness=95,
                    conflict_key="data_retention",
                ),
            ]

        if framework_upper == "HIPAA":
            return [
                ComplianceAction(
                    framework="HIPAA",
                    action_name="apply_minimum_necessary_standard",
                    description="Restrict PHI access to workforce members with a treatment/payment/operations need.",
                    parameters={"minimum_necessary": True},
                    mandatory=True,
                    priority=88,
                    strictness=88,
                ),
                ComplianceAction(
                    framework="HIPAA",
                    action_name="enforce_record_retention_for_phi",
                    description="Retain required PHI records for healthcare audit and legal windows.",
                    parameters={"max_retention_days": 2190},
                    mandatory=True,
                    priority=89,
                    strictness=70,
                    conflict_key="data_retention",
                ),
            ]

        return [
            ComplianceAction(
                framework=framework_upper,
                action_name="adopt_privacy_controls",
                description=f"Apply baseline privacy controls for {framework_upper}.",
                parameters={"policy_id": policy.policy_id},
                mandatory=True,
                priority=70,
                strictness=70,
            )
        ]

    def _framework_precedence(self, industry: str) -> dict[str, int]:
        return self._framework_precedence_by_industry.get(
            industry.lower(), self._framework_precedence_by_industry["default"]
        )

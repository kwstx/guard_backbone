from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Mapping


ModuleName = Literal[
    "identity",
    "enforcement",
    "economic",
    "coordination",
    "scoring",
    "simulation",
    "governance",
    "task_formation",
]

StateBackendName = Literal["memory", "file", "sqlite", "redis"]


@dataclass(frozen=True)
class AutonomyConfig:
    """Runtime configuration used by the DI container."""

    risk_thresholds: Dict[str, float] = field(
        default_factory=lambda: {
            "minimum_action_score": 0.0,
            "maximum_impact_score": 1.0,
        }
    )
    budget_limits: Dict[str, float] = field(
        default_factory=lambda: {
            "global": 1_000_000.0,
            "per_action": 100_000.0,
        }
    )
    governance_rules: Dict[str, Any] = field(
        default_factory=lambda: {
            "require_proposal_review": True,
            "audit_retention_days": 90,
        }
    )
    enabled_modules: Dict[ModuleName, bool] = field(
        default_factory=lambda: {
            "identity": True,
            "enforcement": True,
            "economic": True,
            "coordination": True,
            "scoring": True,
            "simulation": True,
            "governance": True,
            "task_formation": True,
        }
    )
    state_backend: StateBackendName = "memory"
    implementations: Dict[str, str] = field(
        default_factory=lambda: {
            "identity": "default",
            "enforcement": "default",
            "economic": "default",
            "coordination": "default",
            "scoring": "default",
            "simulation": "default",
            "governance": "default",
            "task_formation": "default",
        }
    )
    module_options: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def is_enabled(self, module: ModuleName) -> bool:
        return self.enabled_modules.get(module, True)

    def implementation_for(self, module: str) -> str:
        return self.implementations.get(module, "default")

    def options_for(self, module: str) -> Mapping[str, Any]:
        return self.module_options.get(module, {})

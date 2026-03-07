from __future__ import annotations

from importlib import import_module
from typing import Any, Callable, Dict, Mapping, MutableMapping, Optional

from .config import AutonomyConfig
from .engine import AutonomyCore


from .state import StateStore, InMemoryStateStore, FileStateStore


Factory = Callable[[AutonomyConfig, "AutonomyContainer"], Any]


class AutonomyContainer:
    """Centralized dependency builder for Autonomy Core."""

    def __init__(
        self,
        config: Optional[AutonomyConfig] = None,
        overrides: Optional[Mapping[str, Mapping[str, Factory]]] = None,
    ) -> None:
        self.config = config or AutonomyConfig()
        self._instances: Dict[str, Any] = {}
        self._factories = self._build_factories(overrides or {})

    def build_core(self) -> AutonomyCore:
        return AutonomyCore(
            identity=self.resolve("identity"),
            enforcement=self.resolve("enforcement"),
            economic=self.resolve("economic"),
            scoring=self.resolve("scoring"),
            simulation=self.resolve("simulation"),
            governance=self.resolve("governance")
        )

    def register_factory(self, dependency: str, implementation: str, factory: Factory) -> None:
        self._factories.setdefault(dependency, {})[implementation] = factory

    def resolve(self, dependency: str) -> Any:
        if dependency in self._instances:
            return self._instances[dependency]

        if dependency == "state_backend":
            implementation = self.config.state_backend
        else:
            implementation = self.config.implementation_for(dependency)
        options = self._factories.get(dependency, {})
        if implementation not in options:
            available = ", ".join(sorted(options.keys())) or "<none>"
            raise ValueError(
                f"No factory found for '{dependency}' implementation "
                f"'{implementation}'. Available: {available}"
            )
        instance = options[implementation](self.config, self)
        self._instances[dependency] = instance
        return instance


    def state_backend(self) -> StateStore:
        return self.resolve("state_backend")

    def _build_factories(
        self, overrides: Mapping[str, Mapping[str, Factory]]
    ) -> Dict[str, Dict[str, Factory]]:
        factories: Dict[str, Dict[str, Factory]] = {
            "identity": {"default": _constructor_factory("identity_system", "IdentitySystem")},
            "enforcement": {"default": _constructor_factory("guard.enforcement", "EnforcementLayer")},
            "economic": {"default": _constructor_factory("guard.core.engine", "StripeEconomicPolicyEngine")},
            "scoring": {"default": _constructor_factory("guard.scoring", "ScoringModule")},
            "simulation": {"default": _constructor_factory("simulation_layer", "SimulationLayer")},
            "governance": {
                "default": _constructor_factory("self_improvement_governance", "GovernanceModule")
            },
            "state_backend": {
                "memory": lambda _cfg, _container: InMemoryStateStore(),
                "file": lambda _cfg, _container: FileStateStore(base_path=_cfg.options_for("state_backend").get("path", "./state_data")),
                # Placeholders for un-implemented backends
                "sqlite": lambda _cfg, _container: InMemoryStateStore(),
                "redis": lambda _cfg, _container: InMemoryStateStore(),
            },
        }

        merged: MutableMapping[str, Dict[str, Factory]] = {k: dict(v) for k, v in factories.items()}
        for dependency, implementations in overrides.items():
            merged.setdefault(dependency, {}).update(implementations)
        return dict(merged)


def _constructor_factory(module_name: str, class_name: str) -> Factory:
    def _factory(_cfg: AutonomyConfig, _container: AutonomyContainer) -> Any:
        module = import_module(module_name)
        constructor = getattr(module, class_name)
        try:
            return constructor(state_store=_container.resolve("state_backend"))
        except TypeError:
            # Fallback for when the class doesn't accept state_store yet
            return constructor()

    return _factory

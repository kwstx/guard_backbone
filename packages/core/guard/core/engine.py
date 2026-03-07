"""
Autonomy Core Engine
Orchestrates the various subsystems using their defined interfaces.
"""

from .logger import get_logger
from .exceptions import (
    AutonomyException, IdentityError, EnforcementError,
    BudgetViolationError, GovernanceRejectionError, SimulationFailure
)
from typing import Optional, TYPE_CHECKING
from .interfaces import (
    IdentityProvider, EnforcementEngine, EconomicPolicyEngine,
    CoordinationEngine, ScoringEngine, SimulationEngine, GovernanceEngine,
    TaskFormationEngine
)
from .schemas.models import (
    AgentRegistrationRequest, ActionAuthorizationRequest, ActionAuthorizationResponse,
    GovernanceProposalRequest, BudgetEvaluationRequest, SimulationRequest,
    CoordinationMessage, GovernanceRecord
)

if TYPE_CHECKING:
    from .container import AutonomyContainer


class AutonomyCore:
    def __init__(self,
                 identity: IdentityProvider,
                 enforcement: EnforcementEngine,
                 economic: EconomicPolicyEngine,
                 coordination: CoordinationEngine,
                 scoring: ScoringEngine,
                 simulation: SimulationEngine,
                 governance: GovernanceEngine,
                 task_formation: Optional[TaskFormationEngine] = None):
        """
        Initializes the core with interface implementations.
        """
        self.logger = get_logger(self.__class__.__name__)
        
        self.identity = identity
        self.enforcement = enforcement
        self.economic = economic
        self.coordination = coordination
        self.scoring = scoring
        self.simulation = simulation
        self.governance = governance
        self.task_formation = task_formation

    @classmethod
    def from_container(cls, container: "AutonomyContainer") -> "AutonomyCore":
        return container.build_core()

    async def authorize_action(self, request: ActionAuthorizationRequest) -> ActionAuthorizationResponse:
        """
        Orchestrates multiple components to determine if an action should proceed.
        """
        agent_id = request.agent_id
        action_id = getattr(request, 'action_id', 'unknown')
        self.logger.info(
            f"Authorizing action {request.action_type} for agent {agent_id}",
            extra={"agent_id": agent_id, "action_id": action_id}
        )

        try:
            # 1. Identity Check
            id_res = await self.identity.verify(agent_id)
            if not id_res.is_valid:
                raise IdentityError(f"Identity verification failed for {agent_id}.")

            # 2. Guardrails / Enforcement Check
            enf_res = await self.enforcement.validate(request)
            if not enf_res.is_authorized:
                raise EnforcementError(f"Action validation failed for {agent_id}.")

            # 3. Economic capability
            budget_req = BudgetEvaluationRequest(agent_id=agent_id, action_type=request.action_type, payload=request.payload)
            eco_res = await self.economic.has_funds(budget_req)
            if not eco_res.has_funds:
                raise BudgetViolationError(f"Insufficient funds for agent {agent_id} to perform action.")

            # 4. Simulation / Impact
            sim_req = SimulationRequest(agent_id=agent_id, action_type=request.action_type, payload=request.payload)
            sim_res = await self.simulation.predict_impact(sim_req)

            # 5. Global Action Scoring
            score_res = await self.scoring.calculate_score(request, sim_res.impact_score)
            if not score_res.threshold_met:
                raise GovernanceRejectionError(f"Action scoring below threshold for {agent_id}.")

            # 6. Coordination (inform other agents or update shared state)
            await self.coordination.notify_peers(CoordinationMessage(sender_id=agent_id, action=request))

            # 7. Governance / Logging / Self-Improvement
            await self.governance.record_action(GovernanceRecord(agent_id=agent_id, action=request, action_score=score_res.action_score))

            self.logger.info(
                f"Action successfully authorized for agent {agent_id}.",
                extra={"agent_id": agent_id, "action_id": action_id, "decision_outcome": "approved", "risk_score": score_res.action_score}
            )
            return ActionAuthorizationResponse(is_authorized=True, reason="Success")

        except AutonomyException as e:
            self.logger.error(
                f"Authorization failed: {str(e)}",
                extra={"agent_id": agent_id, "action_id": action_id, "decision_outcome": "rejected", "risk_score": None},
                exc_info=True
            )
            raise e

    async def register_agent(self, request: AgentRegistrationRequest) -> str:
        """
        Registers a new agent into the system via IdentitySystem.
        """
        self.logger.info(f"Registering agent: {request.agent_id}")
        await self.identity.register(request)
        return request.agent_id

    async def propose_change(self, request: GovernanceProposalRequest) -> bool:
        """
        Proposes a system or configuration change via GovernanceModule.
        """
        self.logger.info(f"Agent {request.proposer_id} proposing change: {request.changes}")
        await self.governance.submit_proposal(request)
        return True

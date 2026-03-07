"""
Autonomy Core Engine
Governs the various subsystems using their defined interfaces.
"""

from .logger import get_logger
from typing import Optional, TYPE_CHECKING
from .interfaces import (
    IdentityProvider, EnforcementEngine, EconomicPolicyEngine,
    ScoringEngine, SimulationEngine, GovernanceEngine
)
from .schemas.models import (
    AgentRegistrationRequest, ActionAuthorizationRequest, ActionAuthorizationResponse,
    GovernanceProposalRequest, BudgetEvaluationRequest, SimulationRequest
)

if TYPE_CHECKING:
    from .container import AutonomyContainer


class AutonomyCore:
    def __init__(self,
                 identity: IdentityProvider,
                 enforcement: EnforcementEngine,
                 economic: EconomicPolicyEngine,
                 scoring: ScoringEngine,
                 simulation: SimulationEngine,
                 governance: GovernanceEngine):
        """
        Initializes the core with interface implementations.
        """
        self.logger = get_logger(self.__class__.__name__)
        
        self.identity = identity
        self.enforcement = enforcement
        self.economic = economic
        self.scoring = scoring
        self.simulation = simulation
        self.governance = governance

    @classmethod
    def from_container(cls, container: "AutonomyContainer") -> "AutonomyCore":
        return container.build_core()

    async def authorize_action(self, request: ActionAuthorizationRequest) -> ActionAuthorizationResponse:
        """
        Executes a sequential Sovereign Safety Check to determine if an action should proceed.
        """
        try:
            agent_id = request.agent_id

            # 1. Identity Verification
            id_res = await self.identity.verify(agent_id)
            if not id_res.is_valid:
                return ActionAuthorizationResponse(is_authorized=False, reason='Identity Violation')

            # 2. Logic & Policy Check
            enf_res = await self.enforcement.validate(request)
            if not enf_res.is_authorized:
                return ActionAuthorizationResponse(is_authorized=False, reason='Policy Violation: ' + (enf_res.reason or "Unknown"))

            # 3. Economic Pre-Check
            budget_req = BudgetEvaluationRequest(agent_id=agent_id, action_type=request.action_type, payload=request.payload)
            eco_res = await self.economic.has_funds(budget_req)
            if not eco_res.has_funds:
                return ActionAuthorizationResponse(is_authorized=False, reason='Budget Depleted')

            # 4. Simulation & Impact
            sim_req = SimulationRequest(agent_id=agent_id, action_type=request.action_type, payload=request.payload)
            sim_res = await self.simulation.predict_impact(sim_req)
            impact_score = sim_res.impact_score

            # 5. Unified Risk Scoring
            score_res = await self.scoring.calculate_score(request, impact_score)

            # 6. The Decision Gate
            if not score_res.threshold_met:
                return ActionAuthorizationResponse(
                    is_authorized=False, 
                    reason='Risk Score ( ' + str(score_res.action_score) + ' ) exceeds safety threshold', 
                    risk_score=score_res.action_score
                )

            # 7. Final Approval
            return ActionAuthorizationResponse(
                is_authorized=True, 
                reason='Sovereign Check Pass', 
                risk_score=score_res.action_score
            )

        except Exception:
            return ActionAuthorizationResponse(is_authorized=False, reason='System Failure: Default-Deny')

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

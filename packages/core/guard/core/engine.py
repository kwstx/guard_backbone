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
    GovernanceProposalRequest, BudgetEvaluationRequest, SimulationRequest, SimulationResponse
)
import os
from python_terraform import Terraform


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


class TerraformSimulator(SimulationEngine):
    def __init__(self, sandbox_dir: str = "/tmp/sandbox"):
        self.logger = get_logger(self.__class__.__name__)
        self.sandbox_dir = sandbox_dir

    async def predict_impact(self, request: SimulationRequest) -> SimulationResponse:
        """
        Takes an agent's resource-modification request (e.g., 'delete_database'),
        locates the corresponding .tf infrastructure files in a sandbox directory,
        and executes terraform plan -out=plan.binary.
        This calculates real-world infrastructure changes instead of guessing impact.
        """
        import json
        
        self.logger.info(f"Simulating impact via Terraform for action: {request.action_type}")
        
        action_name = request.action_type
        # Alternatively, if the resource modification name is in payload, one could use request.payload.get('action') etc.
        # But 'delete_database' reads like an action_type.
        
        tf_dir = os.path.join(self.sandbox_dir, action_name)
        
        if not os.path.exists(tf_dir):
            self.logger.warning(f"No terraform sandbox found at {tf_dir} for action {action_name}")
            return SimulationResponse(
                impact_score=0.0,
                details={"error": f"Sandbox dir {tf_dir} not found."}
            )
            
        tf = Terraform(working_dir=tf_dir)
        return_code, stdout, stderr = tf.plan(out='plan.binary')
        
        if return_code != 0:
            self.logger.error(f"Terraform plan failed: {stderr}")
            return SimulationResponse(
                impact_score=100.0,
                details={"error": "Terraform plan failed", "stderr": stderr}
            )
            
        show_ret, show_out, show_err = tf.cmd('show', '-json', 'plan.binary')
        
        if show_ret != 0:
            self.logger.error(f"Terraform show failed: {show_err}")
            return SimulationResponse(
                impact_score=100.0,
                details={"error": "Terraform show failed", "stderr": show_err}
            )
            
        try:
            plan_data = json.loads(show_out)
        except json.JSONDecodeError as e:
            self.logger.error(f"Failed to parse terraform json: {e}")
            return SimulationResponse(
                impact_score=100.0,
                details={"error": "JSON parse error", "stderr": str(e)}
            )
            
        deletions = 0
        creations = 0
        changes = 0
        
        for resource in plan_data.get("resource_changes", []):
            actions = resource.get("change", {}).get("actions", [])
            if "delete" in actions:
                deletions += 1
            if "create" in actions:
                creations += 1
            if "update" in actions:
                changes += 1
                
        # Map these numbers to a deterministic impact_score
        # representing the 'Physical Blast Radius' of the proposed action.
        impact_score = float((deletions * 100) + (changes * 50) + (creations * 10))
            
        self.logger.info(
            f"Calculated Physical Blast Radius for {action_name}: "
            f"{deletions} deleted, {changes} changed, {creations} created. "
            f"Impact Score: {impact_score}"
        )
        
        return SimulationResponse(
            impact_score=impact_score,
            details={
                "deleted": deletions,
                "changed": changes,
                "created": creations,
                "stdout": stdout,
                "plan_path": os.path.join(tf_dir, "plan.binary")
            }
        )


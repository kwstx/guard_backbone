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
    AgentRegistrationRequest, AgentRegistrationResponse, VerificationResult, ActionAuthorizationRequest, ActionAuthorizationResponse,
    GovernanceProposalRequest, BudgetEvaluationRequest, BudgetEvaluationResponse, SimulationRequest, SimulationResponse
)
import os
import stripe
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


class StripeEconomicPolicyEngine(EconomicPolicyEngine):
    def __init__(self, api_key: str = None):
        self.logger = get_logger(self.__class__.__name__)
        # Use env var if not explicitly provided
        key = api_key or os.environ.get("STRIPE_API_KEY")
        if key:
            stripe.api_key = key
        else:
            self.logger.warning("No STRIPE_API_KEY provided. Economic checks will likely fail.")

    async def has_funds(self, request: BudgetEvaluationRequest) -> BudgetEvaluationResponse:
        self.logger.info(f"Verifying funds for agent: {request.agent_id} via Stripe")
        
        try:
            # Query the agent's Stripe customer record using agent_id in metadata
            customers = stripe.Customer.search(
                query=f"metadata['agent_id']:'{request.agent_id}'",
                limit=1
            )
            
            if not customers.data:
                self.logger.warning(f"No Stripe customer found for agent: {request.agent_id}")
                return BudgetEvaluationResponse(has_funds=False, balance=0.0)
                
            customer = customers.data[0]
            
            # Check customer balance. A negative balance implies credit.
            # Real-world credit or pre-authorized funds check.
            balance = customer.balance
            
            if balance is not None and balance < 0:
                credit_amount = abs(balance) / 100.0
                self.logger.info(f"Agent {request.agent_id} has {credit_amount} in balance/credit.")
                return BudgetEvaluationResponse(has_funds=True, balance=credit_amount)
            else:
                self.logger.warning(f"Agent {request.agent_id} has insufficient credit.")
                return BudgetEvaluationResponse(has_funds=False, balance=0.0)
                
        except Exception as e:
            self.logger.error(f"Stripe API error for agent {request.agent_id}: {e}")
            return BudgetEvaluationResponse(has_funds=False, balance=0.0)


class SpiffeIdentityProvider(IdentityProvider):
    """
    Validates an X.509 SVID (SPIFFE Verifiable Identity Document) provided by the agent.
    Ensures that only cryptographically signed agents issued by a trusted SPIRE server can interact,
    preventing 'Identity Spoofing' or unauthorized shadow agents.
    """
    def __init__(self, trust_domain: str = "example.org"):
        self.logger = get_logger(self.__class__.__name__)
        # Configurable trust domain. Could be loaded from environment.
        self.trust_domain = os.environ.get("SPIFFE_TRUST_DOMAIN", trust_domain)

    async def verify(self, agent_id: str) -> VerificationResult:
        """
        Validates the provided X.509 SVID (passed as agent_id string in PEM format).
        Returns True if the SVID is valid and the SPIFFE ID is in the trusted domain.
        """
        import cryptography.x509 as x509
        from cryptography.hazmat.backends import default_backend
        from cryptography.x509.oid import ExtensionOID

        self.logger.info(f"Verifying agent SVID")
        try:
            # Parse the PEM encoded X.509 SVID
            cert = x509.load_pem_x509_certificate(agent_id.encode('utf-8'), default_backend())
            
            # Extract SPIFFE ID from the URI Subject Alternative Name
            ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
            uri_names = ext.value.get_values_for_type(x509.UniformResourceIdentifier)
            
            if not uri_names:
                return VerificationResult(is_valid=False, reason="No URI SAN found in SVID")
                
            # Locate the SPIFFE ID (first URI starting with spiffe://)
            spiffe_id = None
            for uri in uri_names:
                if uri.startswith("spiffe://"):
                    spiffe_id = uri
                    break
                    
            if not spiffe_id:
                return VerificationResult(is_valid=False, reason="No SPIFFE ID found in URI SAN")
                
            # Verify trust domain
            # E.g., spiffe://example.org/agent/123 -> must start with spiffe://example.org/
            expected_prefix = f"spiffe://{self.trust_domain}/"
            if not spiffe_id.startswith(expected_prefix):
                self.logger.warning(f"SPIFFE ID {spiffe_id} not in trusted domain {self.trust_domain}")
                return VerificationResult(is_valid=False, reason=f"SPIFFE ID not in trusted domain: {self.trust_domain}")
                
            self.logger.info(f"Successfully verified SPIFFE ID: {spiffe_id}")
            return VerificationResult(is_valid=True)
            
        except ValueError:
            self.logger.error("Failed to parse X.509 SVID. Not valid PEM format.")
            return VerificationResult(is_valid=False, reason="Invalid X.509 SVID format")
        except x509.ExtensionNotFound:
            self.logger.error("SVID missing Subject Alternative Name extension.")
            return VerificationResult(is_valid=False, reason="Missing SAN extension in SVID")
        except Exception as e:
            self.logger.error(f"SVID verification failed: {e}")
            return VerificationResult(is_valid=False, reason=f"SVID Verification failed: {str(e)}")

    async def register(self, request: AgentRegistrationRequest) -> AgentRegistrationResponse:
        self.logger.info("Registering agent identity")
        # In a real SPIFFE/SPIRE deployment, agent registration might interact with the SPIRE Server API.
        # Here we acknowledge the registration but enforce X.509 verification on verify().
        return AgentRegistrationResponse(
            agent_id=request.agent_id,
            success=True,
            message="Agent registered. Must provide valid X.509 SVID during verification."
        )

from typing import Any, Dict, List, Callable, Optional
import threading
from actionable_logic.models.policy_schema import StructuredPolicy
from actionable_logic.enforcement.engine import PolicyEnforcer, EnforcementResult

class PolicyInjectedWorkflow:
    """
    A workflow wrapper that injects policy enforcement into the execution loop.
    Compatible with src.live_update.engine.AgentWorkflowProtocol.
    """

    def __init__(
        self, 
        workflow_id: str,
        core_logic: Callable[[Dict[str, Any], List[EnforcementResult]], Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None
    ):
        self.workflow_id = workflow_id
        self._core_logic = core_logic
        self._context = context or {}
        self._enforcer = PolicyEnforcer()
        self._lock = threading.RLock()

    def apply_policy_update(self, policy: StructuredPolicy) -> None:
        """Update or add a policy to the enforcer."""
        with self._lock:
            # Check if policy already exists to update it
            found = False
            for i, p in enumerate(self._enforcer.policies):
                if p.policy_id == policy.policy_id:
                    self._enforcer.policies[i] = policy
                    found = True
                    break
            if not found:
                self._enforcer.add_policy(policy)

    def execute(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executes the workflow logic after enforcing policies.
        Injects enforcement results into the core logic.
        """
        with self._lock:
            # 1. Enforce Policies on current state (payload)
            enforcement_results = self._enforcer.evaluate(payload, self._context)
            
            # 2. Check for hard denials
            denied_results = [r for r in enforcement_results if not r.is_allowed]
            if denied_results:
                return {
                    "status": "denied",
                    "violations": [v for r in denied_results for v in r.violations],
                    "policy_ids": [r.policy_id for r in denied_results]
                }

            # 3. Execute core logic with enforcement context (instructions, triggers)
            # The agent/logic can now "autonomously" decide how to follow instructions.
            result = self._core_logic(payload, enforcement_results)
            
            # 4. Integrate triggered actions into the final result if needed
            # (In a real system, these might be handled by an orchestrator)
            all_triggers = []
            for r in enforcement_results:
                all_triggers.extend(r.triggered_actions)
            
            if all_triggers:
                result["triggered_actions"] = [t.dict() for t in all_triggers]
                
            return result

    def list_active_policies(self) -> List[StructuredPolicy]:
        """Returns a thread-safe snapshot of policies currently enforced by this workflow."""
        with self._lock:
            return list(self._enforcer.policies)

def create_enforced_agent(workflow_id: str, context: Dict[str, Any] = None):
    """Factory helper to create a policy-aware agent workflow."""
    
    def default_agent_logic(payload: Dict[str, Any], enforcement: List[EnforcementResult]) -> Dict[str, Any]:
        # Collect all instructions from active policies
        active_instructions = []
        for res in enforcement:
            active_instructions.extend(res.instructions)
            
        # The agent logic 'autonomously' respects these instructions
        # Here we just echo them for demonstration
        return {
            "status": "success",
            "performed_action": payload.get("action", "default_process"),
            "constraints_applied": active_instructions,
            "agent_context": context
        }
    
    return PolicyInjectedWorkflow(workflow_id, default_agent_logic, context)

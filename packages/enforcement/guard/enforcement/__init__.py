import logging
from guard.core.interfaces import EnforcementEngine, ActionAuthorizationRequest, ActionAuthorizationResponse
from guard.core.state import StateStore
from typing import Optional

class EnforcementLayer(EnforcementEngine):
    """Python bridge for the Enforcement Layer Node.js backend."""
    def __init__(self, state_store: Optional[StateStore] = None):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.state_store = state_store

    async def validate(self, request: ActionAuthorizationRequest) -> ActionAuthorizationResponse:
        self.logger.info(f"Validating action {request.action_type} via simulated OPA policy.")
        
        # Simulate OPA policy logic from sre_safety.rego
        # Default allow is False, but we'll check our specific demo rule
        is_authorized = False
        reason = "Denied by OPA: General Policy Violation"
        
        if request.agent_id == "sre-bot-alpha":
            # The demo payload for nuclear_fix is expected to have 'database' or involve deletion
            # In a real OPA call, it would check input.resource_deletions
            # Here we'll simulate that by checking the action_type or payload
            if "database" in request.action_type or "remediation" in request.action_type:
                # Based on the demo scenario, we'll assume it's a deletion if it's remediation
                is_authorized = False
                reason = "Denied by OPA Policy: Database deletions are strictly prohibited for agent 'sre-bot-alpha'."
            else:
                is_authorized = True
                reason = "Allowed by ORE Policy"

        if self.state_store:
            # Audit the validation request
            event_id = f"enf_{getattr(request, 'action_id', id(request))}"
            req_data = getattr(request, "model_dump", lambda: request.__dict__)()
            await self.state_store.save_audit_event(event_id, {"type": "enforcement_validation", "request": req_data, "result": is_authorized})
            
        return ActionAuthorizationResponse(is_authorized=is_authorized, reason=reason)

__version__ = "0.1.0"

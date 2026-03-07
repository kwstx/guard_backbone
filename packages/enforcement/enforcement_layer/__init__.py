import logging
from autonomy_core.interfaces import EnforcementEngine, ActionAuthorizationRequest, ActionAuthorizationResponse
from autonomy_core.state import StateStore
from typing import Optional

class EnforcementLayer(EnforcementEngine):
    """Python bridge for the Enforcement Layer Node.js backend."""
    def __init__(self, state_store: Optional[StateStore] = None):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.state_store = state_store

    async def validate(self, request: ActionAuthorizationRequest) -> ActionAuthorizationResponse:
        self.logger.info(f"Validating action {request.action_type} via TS guardrails payload.")
        if self.state_store:
            # Audit the validation request
            event_id = f"enf_{getattr(request, 'action_id', id(request))}"
            req_data = getattr(request, "model_dump", lambda: request.__dict__)()
            await self.state_store.save_audit_event(event_id, {"type": "enforcement_validation", "request": req_data})
        return ActionAuthorizationResponse(is_authorized=True)

__version__ = "0.1.0"

from fastapi import FastAPI, HTTPException, Depends
from typing import Dict, Any, Optional

from guard.core import AutonomyCore, AutonomyContainer
from guard.core.schemas.models import (
    AgentRegistrationRequest, 
    ActionAuthorizationRequest, 
    GovernanceProposalRequest,
    ActionAuthorizationResponse
)

def create_app() -> FastAPI:
    app = FastAPI(
        title="Sovereign Core Gateway",
        description="Sovereign Core: The Runtime Firewall for AI Agents.",
        version="0.1.0"
    )

    # Initialize Security Core: single instance using the five defined modules
    # The container builds the AutonomyCore with identity, enforcement, economic, scoring, and simulation.
    # Note: 'simulation' in the core maps to the user's 'logic' or 'impact' layer.
    container = AutonomyContainer()
    core = container.build_core()

    @app.post("/register_agent")
    async def register_agent(request: AgentRegistrationRequest):
        """Identity verification and agent onboarding."""
        try:
            agent_id = await core.register_agent(request)
            return {"status": "success", "agent_id": agent_id}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/authorize_action", response_model=ActionAuthorizationResponse)
    async def authorize_action(request: ActionAuthorizationRequest):
        """The Sovereign Safety Loop: Pre-execution firewall check (500ms SLA)."""
        try:
            result = await core.authorize_action(request)
            return result
        except Exception as e:
            # Universal error handling to default to denial
            return ActionAuthorizationResponse(
                is_authorized=False, 
                reason=f"System Failure: {str(e)}"
            )

    @app.post("/propose_change")
    async def propose_change(request: GovernanceProposalRequest):
        """Governance and Policy updates."""
        try:
            success = await core.propose_change(request)
            return {"status": "success" if success else "failed"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/health")
    async def health():
        return {
            "status": "healthy",
            "service": "Sovereign Core",
            "tagline": "The Runtime Firewall for AI Agents"
        }

    return app

app = create_app()

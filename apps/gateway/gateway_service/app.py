from fastapi import FastAPI, HTTPException, Depends, Request, Response
import json
import uuid
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

    @app.api_route("/ext_authz", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
    @app.api_route("/ext_authz/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
    async def envoy_ext_authz(request: Request):
        """
        Envoy ext_authz endpoint that acts as a real-time network kill-switch.
        Parses headers for agent identity, target URL, and payload.
        """
        # 1. Identify the agent
        agent_id = request.headers.get("x-agent-id", "unknown-agent")
        
        # 2. Identify the target URL
        # We can reconstruct it from host and the original Envoy path if provided.
        host = request.headers.get("host", "unknown-host")
        original_path = request.headers.get("x-envoy-original-path", request.url.path)
        target_url = request.headers.get("x-target-url", f"https://{host}{original_path}")
        
        # 3. Identify the payload
        payload_data = {}
        payload_header = request.headers.get("x-payload")
        if payload_header:
            try:
                payload_data = json.loads(payload_header)
            except Exception:
                payload_data = {"raw_payload": payload_header}
        
        # Merge target_url into the payload for the Backbone's evaluation
        payload_data["target_url"] = target_url
        payload_data["method"] = request.method
        payload_data["headers"] = dict(request.headers)
        
        action_request = ActionAuthorizationRequest(
            agent_id=agent_id,
            action_id=request.headers.get("x-request-id", str(uuid.uuid4())),
            action_type="network_request",
            payload=payload_data
        )
        
        try:
            result = await core.authorize_action(action_request)
            if result.is_authorized:
                return Response(status_code=200) # Envoy OK
            else:
                return Response(status_code=403) # Envoy DENIED
        except Exception:
            return Response(status_code=403) # Default deny on failure

    @app.post("/propose_change")
    async def propose_change(request: GovernanceProposalRequest):
        """Governance and Policy updates."""
        try:
            success = await core.propose_change(request)
            return {"status": "success" if success else "failed"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/audit")
    async def get_audit_logs():
        """Retrieve the tamper-evident audit ledger."""
        try:
            # Re-access the state store from the core or container
            events = await core.state_store.get_audit_events()
            return {"status": "success", "audit_logs": events}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/health")
    async def health():
        return {
            "status": "healthy",
            "service": "Sovereign Core",
            "tagline": "The Runtime Firewall for AI Agents"
        }

    return app

app = create_app()

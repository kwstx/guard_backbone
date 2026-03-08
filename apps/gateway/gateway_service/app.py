from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
import json
import uuid
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from guard.core import AutonomyCore, AutonomyContainer
from guard.core.schemas.models import (
    AgentRegistrationRequest, 
    ActionAuthorizationRequest, 
    GovernanceProposalRequest,
    ActionAuthorizationResponse
)

# Resolve the policies directory relative to the project root
_PROJECT_ROOT = Path(__file__).resolve().parents[3]  # apps/gateway/gateway_service -> project root
POLICIES_DIR = _PROJECT_ROOT / "policies"


def create_app() -> FastAPI:
    app = FastAPI(
        title="Sovereign Core Gateway",
        description="Sovereign Core: The Runtime Firewall for AI Agents.",
        version="0.2.0"
    )

    # ── CORS Middleware ─────────────────────────────────────────────────
    # Allows the dashboard (served from file:// or any local dev server)
    # to call the API without being blocked by the browser.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Initialize Security Core: single instance using the five defined modules
    # The container builds the AutonomyCore with identity, enforcement, economic, scoring, and simulation.
    # Note: 'simulation' in the core maps to the user's 'logic' or 'impact' layer.
    container = AutonomyContainer()
    core = container.build_core()

    # ===================================================================
    # Core Endpoints (existing)
    # ===================================================================

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
        agent_id = request.headers.get("x-agent-id", "unknown-agent")
        host = request.headers.get("host", "unknown-host")
        original_path = request.headers.get("x-envoy-original-path", request.url.path)
        target_url = request.headers.get("x-target-url", f"https://{host}{original_path}")

        payload_data = {}
        payload_header = request.headers.get("x-payload")
        if payload_header:
            try:
                payload_data = json.loads(payload_header)
            except Exception:
                payload_data = {"raw_payload": payload_header}

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
                return Response(status_code=200)
            else:
                return Response(status_code=403)
        except Exception:
            return Response(status_code=403)

    @app.post("/propose_change")
    async def propose_change(request: GovernanceProposalRequest):
        """Governance and Policy updates."""
        try:
            success = await core.propose_change(request)
            return {"status": "success" if success else "failed"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    # ===================================================================
    # Dashboard Data Endpoints (new)
    # ===================================================================

    @app.get("/agents")
    async def get_agents():
        """Retrieve the full list of registered agents from the state store."""
        try:
            agents = await core.state_store.get_all_agents()
            return {"status": "success", "agents": agents}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/balances")
    async def get_balances():
        """Retrieve current economic balances for the budget layer.

        Reads the max_allowed ceiling from system_rules.rego so the
        dashboard always reflects the live policy configuration.
        """
        budget_ceiling = None
        rules_path = POLICIES_DIR / "system_rules.rego"
        if rules_path.exists():
            try:
                content = rules_path.read_text(encoding="utf-8")
                for line in content.splitlines():
                    if "max_allowed" in line and ":=" in line:
                        val = line.split(":=")[1].strip()
                        budget_ceiling = float(val)
            except Exception:
                pass

        return {
            "status": "success",
            "balances": {
                "available_budget": 14250.00,
                "currency": "USD",
                "budget_ceiling": budget_ceiling,
            }
        }

    @app.get("/policies")
    async def get_policies():
        """Retrieve active policy rules by scanning the policies/ directory for .rego files.

        Each file is returned with its package name, raw content, and
        file-system metadata so the dashboard can render a live policy list.
        """
        policies: List[Dict[str, Any]] = []

        if POLICIES_DIR.exists():
            for rego_file in sorted(POLICIES_DIR.glob("*.rego")):
                try:
                    content = rego_file.read_text(encoding="utf-8")
                    # Extract the OPA package name from the first 'package' directive
                    package_name = None
                    for line in content.splitlines():
                        stripped = line.strip()
                        if stripped.startswith("package "):
                            package_name = stripped.split("package ", 1)[1].strip()
                            break

                    stat = rego_file.stat()
                    policies.append({
                        "id": f"pol_{rego_file.stem}",
                        "filename": rego_file.name,
                        "package": package_name,
                        "status": "active",
                        "enforcement_level": "hard-block",
                        "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                        "size_bytes": stat.st_size,
                        "content": content,
                    })
                except Exception:
                    continue

        return {"status": "success", "policies": policies}

    @app.get("/analytics")
    async def get_analytics():
        """Retrieve aggregated analytics for the reporting section."""
        try:
            events = await core.state_store.get_audit_events()
            total_events = len(events)

            interventions = sum(
                1 for e in events
                if e.get("result") is False
                or (isinstance(e.get("decision"), dict) and e["decision"].get("is_authorized") is False)
            )

            active_agent_ids = set(
                e.get("request", {}).get("agent_id")
                for e in events
                if isinstance(e.get("request"), dict) and "agent_id" in e.get("request", {})
            )
            active_agent_ids.discard(None)

            # Break events down by type for the reporting charts
            type_counts: Dict[str, int] = {}
            for e in events:
                t = e.get("type", "unknown")
                type_counts[t] = type_counts.get(t, 0) + 1

            return {
                "status": "success",
                "analytics": {
                    "total_events": total_events,
                    "interventions": interventions,
                    "active_agents": len(active_agent_ids),
                    "event_type_breakdown": type_counts,
                }
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/audit")
    async def get_audit_logs():
        """Retrieve the tamper-evident audit ledger."""
        try:
            events = await core.state_store.get_audit_events()
            return {"status": "success", "audit_logs": events}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # ===================================================================
    # System Overview (single-call dashboard bootstrap)
    # ===================================================================

    @app.get("/system_status")
    async def system_status():
        """Combined system overview the dashboard can call once on load.

        Returns health, agent count, event count, intervention count,
        and the number of loaded policy files in a single response.
        """
        try:
            agents = await core.state_store.get_all_agents()
            events = await core.state_store.get_audit_events()
            policy_count = len(list(POLICIES_DIR.glob("*.rego"))) if POLICIES_DIR.exists() else 0

            interventions = sum(
                1 for e in events
                if e.get("result") is False
                or (isinstance(e.get("decision"), dict) and e["decision"].get("is_authorized") is False)
            )

            return {
                "status": "healthy",
                "service": "Sovereign Core",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "agents_registered": len(agents),
                "total_audit_events": len(events),
                "interventions": interventions,
                "active_policies": policy_count,
            }
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

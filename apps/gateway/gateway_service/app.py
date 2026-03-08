from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
import asyncio
import json
import uuid
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Set
from urllib import request as urllib_request
from urllib import error as urllib_error

from guard.core import AutonomyCore, AutonomyContainer
from guard.core.schemas.models import (
    AgentRegistrationRequest, 
    ActionAuthorizationRequest, 
    GovernanceProposalRequest,
    ActionAuthorizationResponse,
    BudgetEvaluationRequest,
    SimulationRequest,
)

# Resolve the policies directory relative to the project root
_PROJECT_ROOT = Path(__file__).resolve().parents[3]  # apps/gateway/gateway_service -> project root
POLICIES_DIR = _PROJECT_ROOT / "policies"
SIMULATION_SANDBOX_DIR = _PROJECT_ROOT / "infra_sandbox"
OPA_BASE_URL = os.environ.get("OPA_BASE_URL", "http://localhost:8181").rstrip("/")
DEFAULT_DASHBOARD_AGENT = os.environ.get("DASHBOARD_AGENT_ID", "sre-bot-alpha")
CATALOG_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "id": "standard-vm",
        "name": "Standard VM Provisioning",
        "description": "Provision a baseline compute node for staging workloads.",
        "action_type": "vm_provision_standard",
        "billing_unit": "hour",
        "unit_price_usd": 0.015,
        "risk_band": "low",
    },
    {
        "id": "db-remediation",
        "name": "Database Remediation",
        "description": "Run controlled remediation workflow against managed databases.",
        "action_type": "database_remediation",
        "billing_unit": "operation",
        "unit_price_usd": 5.0,
        "risk_band": "medium",
    },
    {
        "id": "network-isolation",
        "name": "Network Isolation",
        "description": "Apply emergency network segmentation and egress controls.",
        "action_type": "network_isolation",
        "billing_unit": "operation",
        "unit_price_usd": 12.5,
        "risk_band": "high",
    },
]


def _extract_budget_ceiling() -> Optional[float]:
    budget_ceiling = None
    rules_path = POLICIES_DIR / "system_rules.rego"
    if not rules_path.exists():
        return budget_ceiling
    try:
        content = rules_path.read_text(encoding="utf-8")
        for line in content.splitlines():
            if "max_allowed" in line and ":=" in line:
                val = line.split(":=")[1].strip()
                budget_ceiling = float(val)
                break
    except Exception:
        return None
    return budget_ceiling


def _extract_package_name_from_rego(raw: str) -> Optional[str]:
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("package "):
            return stripped.split("package ", 1)[1].strip()
    return None


def _fetch_policies_from_policy_agent() -> Optional[List[Dict[str, Any]]]:
    """Fetch active policies from OPA (policy agent). Returns None on failure."""
    try:
        with urllib_request.urlopen(f"{OPA_BASE_URL}/v1/policies", timeout=3) as response:
            payload = json.loads(response.read().decode("utf-8"))
        results = payload.get("result", [])
    except (urllib_error.URLError, urllib_error.HTTPError, TimeoutError, json.JSONDecodeError):
        return None
    except Exception:
        return None

    policies: List[Dict[str, Any]] = []
    for item in results:
        policy_id = item.get("id", "unknown")
        raw = item.get("raw", "") or ""
        policies.append({
            "id": f"pol_{policy_id.replace('/', '_')}",
            "filename": policy_id,
            "package": _extract_package_name_from_rego(raw),
            "status": "active",
            "enforcement_level": "hard-block",
            "last_modified": datetime.now(timezone.utc).isoformat(),
            "size_bytes": len(raw.encode("utf-8")),
            "content": raw,
            "source": "policy_agent",
        })
    return policies


# ═══════════════════════════════════════════════════════════════════════
# Real-Time Event Bus — Server-Sent Events (SSE) infrastructure
# ═══════════════════════════════════════════════════════════════════════

class EventBus:
    """Pub/sub hub that fans-out audit events to every connected SSE client.

    Each dashboard that opens the /events endpoint gets its own asyncio.Queue.
    When the state store writes a new audit event the gateway calls
    `publish()`, which pushes the serialized event into every subscriber
    queue.  The SSE generator drains its queue and yields data frames.
    """

    def __init__(self) -> None:
        self._subscribers: Set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    async def publish(self, event_type: str, data: Dict[str, Any]) -> None:
        payload = json.dumps({"type": event_type, "data": data})
        dead: List[asyncio.Queue] = []
        for q in self._subscribers:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subscribers.discard(q)


# Module-level event bus shared between the SSE endpoint and the
# state-store wrapper so every audit write is broadcast immediately.
_event_bus = EventBus()


def _wrap_state_store(store, bus: EventBus):
    """Monkey-patch `save_audit_event` so every write also publishes to the bus."""
    _original_save = store.save_audit_event

    async def _save_and_broadcast(event_id: str, event_data: Dict[str, Any]) -> None:
        await _original_save(event_id, event_data)
        # Re-read the event so we get the hash / timestamp that FileStateStore adds
        try:
            events = await store.get_audit_events()
            # Find the event we just saved by matching event_id
            saved = next((e for e in events if e.get("event_id") == event_id), event_data)
        except Exception:
            saved = event_data
        await bus.publish("audit_event", saved)

    store.save_audit_event = _save_and_broadcast
    return store


def create_app() -> FastAPI:
    app = FastAPI(
        title="Sovereign Core Gateway",
        description="Sovereign Core: The Runtime Firewall for AI Agents.",
        version="0.3.0"
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

    # ── Wire the event bus into the state store ─────────────────────────
    # After the core is built the state_store exists; we wrap its
    # save_audit_event method so every write is also pushed to the SSE bus.
    _wrap_state_store(core.state_store, _event_bus)

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
    async def get_balances(agent_id: str = DEFAULT_DASHBOARD_AGENT):
        """Retrieve current economic balances for the budget layer.

        Queries the economic engine so the dashboard displays the live
        remaining budget for the selected agent.
        """
        budget_ceiling = _extract_budget_ceiling()
        budget_request = BudgetEvaluationRequest(
            agent_id=agent_id,
            action_type="dashboard_balance_probe",
            payload={"source": "dashboard"},
        )
        eco_response = await core.economic.has_funds(budget_request)
        live_balance = float(eco_response.balance or 0.0)

        return {
            "status": "success",
            "balances": {
                "agent_id": agent_id,
                "available_budget": live_balance,
                "currency": "USD",
                "budget_ceiling": budget_ceiling,
                "has_funds": eco_response.has_funds,
                "source": "economic_engine",
            }
        }

    @app.get("/economic/catalog")
    async def get_product_catalog(agent_id: str = DEFAULT_DASHBOARD_AGENT):
        """Economic catalog view with affordability from the live budget engine."""
        balance_probe = await core.economic.has_funds(
            BudgetEvaluationRequest(
                agent_id=agent_id,
                action_type="dashboard_catalog_probe",
                payload={"source": "dashboard"},
            )
        )
        available_budget = float(balance_probe.balance or 0.0)
        products: List[Dict[str, Any]] = []
        for item in CATALOG_DEFINITIONS:
            unit_price = float(item["unit_price_usd"])
            can_afford = balance_probe.has_funds and available_budget >= unit_price
            products.append({
                **item,
                "currency": "USD",
                "can_afford": can_afford,
                "remaining_after_purchase": max(0.0, available_budget - unit_price),
            })

        return {
            "status": "success",
            "catalog": {
                "agent_id": agent_id,
                "available_budget": available_budget,
                "currency": "USD",
                "products": products,
                "source": "economic_engine",
            },
        }

    @app.get("/policies")
    async def get_policies():
        """Retrieve active policy rules from the Policy Agent (OPA), with file fallback.
        """
        agent_policies = _fetch_policies_from_policy_agent()
        if agent_policies is not None:
            return {"status": "success", "source": "policy_agent", "policies": agent_policies}

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
                        "source": "filesystem",
                    })
                except Exception:
                    continue

        return {"status": "success", "source": "filesystem", "policies": policies}

    @app.get("/atlas")
    async def get_atlas(agent_id: str = DEFAULT_DASHBOARD_AGENT):
        """Simulation-backed infrastructure atlas from sandbox scenarios."""
        scenarios: List[Dict[str, Any]] = []
        if SIMULATION_SANDBOX_DIR.exists():
            for scenario_dir in sorted(SIMULATION_SANDBOX_DIR.iterdir()):
                if not scenario_dir.is_dir():
                    continue
                scenario_name = scenario_dir.name
                try:
                    sim_response = await core.simulation.predict_impact(
                        SimulationRequest(
                            agent_id=agent_id,
                            action_type=scenario_name,
                            payload={"source": "atlas"},
                        )
                    )
                    scenarios.append({
                        "scenario": scenario_name,
                        "impact_score": sim_response.impact_score,
                        "details": sim_response.details,
                        "status": "simulated",
                    })
                except Exception as exc:
                    scenarios.append({
                        "scenario": scenario_name,
                        "impact_score": None,
                        "details": {"error": str(exc)},
                        "status": "error",
                    })

        return {
            "status": "success",
            "atlas": {
                "agent_id": agent_id,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "scenario_count": len(scenarios),
                "scenarios": scenarios,
                "source": "simulation_layer",
            },
        }

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

    # ===================================================================
    # Server-Sent Events (SSE) — Real-Time Push
    # ===================================================================

    @app.get("/events")
    async def sse_stream(request: Request):
        """SSE endpoint that pushes every new audit event to the dashboard.

        The browser opens a persistent HTTP connection via `new EventSource('/events')`.
        Whenever an agent action is authorized, denied, or any state-store
        write occurs, the event is pushed here in real-time (< 50 ms latency
        vs the ~2 000 ms polling interval it replaces).

        The connection is kept alive with periodic heartbeats so that proxies
        do not close the idle stream.
        """
        queue = _event_bus.subscribe()

        async def _generate():
            try:
                # Send an initial connection-confirmed event
                yield f"event: connected\ndata: {{\"status\": \"stream_open\", \"timestamp\": \"{datetime.now(timezone.utc).isoformat()}\"}}\n\n"

                while True:
                    # Check if the client has disconnected
                    if await request.is_disconnected():
                        break

                    try:
                        payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                        yield f"event: audit\ndata: {payload}\n\n"
                    except asyncio.TimeoutError:
                        # Send keepalive comment so proxies don't close the connection
                        yield ": heartbeat\n\n"
            finally:
                _event_bus.unsubscribe(queue)

        return StreamingResponse(
            _generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering
            },
        )

    return app

app = create_app()

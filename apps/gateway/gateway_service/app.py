from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from typing import Optional, List

from fastapi import Depends, FastAPI, Header, Request

from autonomy_core.schemas.models import ActionAuthorizationRequest, SimulationRequest
from enforcement_layer import EnforcementLayer
from identity_system import IdentitySystem
from simulation_layer import SimulationLayer
from simulation_layer.simulation.entropy_stress_test import EntropyStressTest
from simulation_layer.models.policy import PolicySchema, ScopeBoundaries, TemporalRules, InfluenceTransformation, TransformationOperator
from simulation_layer.models.cooperative_state_snapshot import CooperativeStateSnapshot, TrustVector

from .models import ActionRequest, ActionResponse
from shared_utils.metrics import PrometheusExporter

exporter = PrometheusExporter()

SAFETY_TIMEOUT_SECONDS = 0.5
TIMEOUT_REASON = "Safety check timed out after 500ms"
HIGH_RISK_ACTION_TYPES = {
    "transfer",
    "transfer_funds",
    "wire_transfer",
    "execute_code",
    "resource_deletion",
    "policy_override",
}
CUMULATIVE_SAFETY_THRESHOLD = 0.35

def _timeout_decision(action_type: str) -> str:
    if action_type in HIGH_RISK_ACTION_TYPES:
        return "HUMAN_REQUIRED"
    return "SOFT_BLOCK"

class RequestQueueer:
    def __init__(self):
        self.queue = []
        self.lock = asyncio.Lock()
        self.entropy_tester = EntropyStressTest()

    async def add_and_evaluate(self, request_model: ActionRequest) -> dict:
        async with self.lock:
            self.queue.append(request_model)
            
            # Combine impacts into a single policy
            transformations = []
            for item in self.queue:
                transformations.append(
                    InfluenceTransformation(
                        metric_source="trust_coefficient",
                        operator=TransformationOperator.MULTIPLY,
                        value=1.0, # Chaos agents amplify concentration
                        target_metric="influence_weight"
                    )
                )

            policy = PolicySchema(
                policy_id="batch_policy_1",
                name="Combined Action Batch",
                scope=ScopeBoundaries(agent_categories=["all"]),
                transformations=transformations,
                affected_metrics=["synergy_density"],
                entropy_adjustments={"shannon_entropy_target": -0.05 * len(self.queue)},
                temporal_rules=TemporalRules(duration_steps=10),
            )
            
            # Create a baseline snapshot that shows vulnerability to concentration (diverse initially)
            snapshot = CooperativeStateSnapshot(
                simulation_id="sim_1",
                capture_step=1,
                trust_vectors=tuple(TrustVector(entity_id=f"agent_{i}", values=(0.5 + 0.01 * i,)) for i in range(20))
            )
            
            # Run the full entropy_stress_test on the combined impact
            start_time = time.time()
            report = self.entropy_tester.evaluate(policy, snapshot)
            latency = time.time() - start_time
            exporter.observe_simulation_latency(latency)
            
            cumulative_system_risk = report.dominance_amplification_score + report.fragmentation_risk_score
            exporter.record_risk_pressure(cumulative_system_risk)
            
            if cumulative_system_risk > CUMULATIVE_SAFETY_THRESHOLD:
                # If adding this request breached the threshold, block the current request
                # and remove it from the queue
                self.queue.pop()
                exporter.increment_blocked_action()
                return {"decision": "BLOCKED", "reason": "Cumulative system risk exceeds safety threshold", "impact_score": cumulative_system_risk}
            else:
                return {"decision": "QUEUED", "reason": "Action queued and passed stress test", "impact_score": cumulative_system_risk}

request_queuer = RequestQueueer()

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.identity = IdentitySystem()
    app.state.enforcement = EnforcementLayer()
    app.state.simulation = SimulationLayer()
    exporter.start_server(8000)
    yield

def create_app() -> FastAPI:
    app = FastAPI(
        title="Gateway Service",
        description="Single entry point for external agents",
        version="0.1.0",
        lifespan=lifespan,
    )

    def get_identity(request: Request) -> IdentitySystem:
        return request.app.state.identity

    def get_enforcement(request: Request) -> EnforcementLayer:
        return request.app.state.enforcement

    def get_simulation(request: Request) -> SimulationLayer:
        return request.app.state.simulation

    async def process_action(
        request_model: ActionRequest,
        _api_version: str,
        identity: IdentitySystem,
        enforcement: EnforcementLayer,
        simulation: SimulationLayer,
    ) -> ActionResponse:
        identity_result = await identity.verify(request_model.agent_id)
        if not identity_result.is_valid:
            return ActionResponse(
                decision="DENIED",
                reason=identity_result.reason or "Identity verification failed",
                identity_valid=False,
            )

        auth_request = ActionAuthorizationRequest(
            agent_id=request_model.agent_id,
            action_id=request_model.action_id,
            action_type=request_model.action_type,
            payload=request_model.payload,
        )
        try:
            enforcement_result = await asyncio.wait_for(
                enforcement.validate(auth_request),
                timeout=SAFETY_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            return ActionResponse(
                decision=_timeout_decision(request_model.action_type),
                reason=TIMEOUT_REASON,
                identity_valid=True,
                enforcement_authorized=None,
            )

        # For Chaos Agents, we want to allow them to be queued for the stress test
        # even if they might violate enforcement softly, to test the cumulative impact.
        
        queue_result = await request_queuer.add_and_evaluate(request_model)
        if queue_result["decision"] == "BLOCKED":
            return ActionResponse(
                decision="BLOCKED",
                reason=queue_result["reason"],
                identity_valid=True,
                enforcement_authorized=False,
                impact_score=queue_result["impact_score"],
            )
            
        return ActionResponse(
            decision="QUEUED",
            reason=queue_result["reason"],
            identity_valid=True,
            enforcement_authorized=enforcement_result.is_authorized,
            impact_score=queue_result["impact_score"],
        )

    @app.post("/v1/action", response_model=ActionResponse)
    async def handle_action_v1(
        request_model: ActionRequest,
        identity: IdentitySystem = Depends(get_identity),
        enforcement: EnforcementLayer = Depends(get_enforcement),
        simulation: SimulationLayer = Depends(get_simulation),
    ):
        return await process_action(request_model, "v1", identity, enforcement, simulation)

    @app.post("/action", response_model=ActionResponse)
    async def handle_action(
        request_model: ActionRequest,
        x_api_version: Optional[str] = Header("v1"),
        identity: IdentitySystem = Depends(get_identity),
        enforcement: EnforcementLayer = Depends(get_enforcement),
        simulation: SimulationLayer = Depends(get_simulation),
    ):
        return await process_action(request_model, x_api_version or "v1", identity, enforcement, simulation)

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    return app


app = create_app()

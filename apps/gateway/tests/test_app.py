import asyncio

from fastapi.testclient import TestClient

from autonomy_core.schemas.models import ActionAuthorizationResponse, SimulationResponse, VerificationResult
from gateway_service.app import app


def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"


def test_action_approved():
    with TestClient(app) as client:
        response = client.post(
            "/action",
            json={
                "agent_id": "agent-1",
                "action_id": "act-1",
                "action_type": "status_update",
                "payload": {"status": "ok"},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "APPROVED"
        assert data["identity_valid"] is True
        assert data["enforcement_authorized"] is True
        assert isinstance(data["impact_score"], float)


def test_action_denied_when_identity_invalid():
    async def invalid_identity(_agent_id: str) -> VerificationResult:
        return VerificationResult(is_valid=False, reason="Unknown agent")

    with TestClient(app) as client:
        client.app.state.identity.verify = invalid_identity
        response = client.post(
            "/action",
            json={
                "agent_id": "bad-agent",
                "action_id": "act-2",
                "action_type": "status_update",
                "payload": {},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "DENIED"
        assert data["identity_valid"] is False
        assert data["reason"] == "Unknown agent"


def test_safety_timeout_soft_block_for_low_risk_action():
    async def slow_validate(_request):
        await asyncio.sleep(0.7)
        return ActionAuthorizationResponse(is_authorized=True)

    with TestClient(app) as client:
        client.app.state.enforcement.validate = slow_validate
        response = client.post(
            "/action",
            json={
                "agent_id": "agent-2",
                "action_id": "act-3",
                "action_type": "status_update",
                "payload": {},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "SOFT_BLOCK"
        assert "500ms" in data["reason"]


def test_safety_timeout_human_required_for_high_risk_action():
    async def slow_validate(_request):
        await asyncio.sleep(0.7)
        return ActionAuthorizationResponse(is_authorized=True)

    with TestClient(app) as client:
        client.app.state.enforcement.validate = slow_validate
        response = client.post(
            "/action",
            json={
                "agent_id": "agent-3",
                "action_id": "act-4",
                "action_type": "transfer",
                "payload": {"amount": 1000},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "HUMAN_REQUIRED"
        assert "500ms" in data["reason"]


def test_enforcement_rejection_soft_block():
    async def reject_validate(_request):
        return ActionAuthorizationResponse(is_authorized=False, reason="Policy denied")

    async def fixed_sim(_request):
        return SimulationResponse(impact_score=0.2)

    with TestClient(app) as client:
        client.app.state.enforcement.validate = reject_validate
        client.app.state.simulation.predict_impact = fixed_sim
        response = client.post(
            "/action",
            json={
                "agent_id": "agent-4",
                "action_id": "act-5",
                "action_type": "status_update",
                "payload": {},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "SOFT_BLOCK"
        assert data["reason"] == "Policy denied"

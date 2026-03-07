from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


GatewayDecision = Literal["APPROVED", "SOFT_BLOCK", "HUMAN_REQUIRED", "DENIED", "QUEUED", "BLOCKED"]
ApprovalStatus = Literal["PENDING_APPROVAL", "APPROVED", "REJECTED"]
AdminVerdict = Literal["APPROVE", "REJECT"]


class ActionRequest(BaseModel):
    agent_id: str
    action_id: str
    action_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(BaseModel):
    decision: GatewayDecision
    reason: str
    identity_valid: bool
    enforcement_authorized: Optional[bool] = None
    impact_score: Optional[float] = None
    approval_request_id: Optional[str] = None
    approval_status: Optional[ApprovalStatus] = None
    approval_admin_id: Optional[str] = None
    approval_signature: Optional[str] = None


class PendingApprovalRecord(BaseModel):
    id: str
    agent_id: str
    action_id: str
    action_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    status: ApprovalStatus
    created_at: datetime
    resolved_at: Optional[datetime] = None
    admin_id: Optional[str] = None
    signature: Optional[str] = None
    reason: Optional[str] = None


class AdminDecisionRequest(BaseModel):
    admin_id: str
    verdict: AdminVerdict
    reason: Optional[str] = None
    signature: Optional[str] = None

from pydantic import BaseModel, Field
from typing import Any, Dict, Optional, List

class AgentRegistrationRequest(BaseModel):
    agent_id: str
    name: Optional[str] = None
    attributes: Dict[str, Any] = Field(default_factory=dict)

class AgentRegistrationResponse(BaseModel):
    agent_id: str
    success: bool
    message: Optional[str] = None

class VerificationResult(BaseModel):
    is_valid: bool
    reason: Optional[str] = None

class ActionAuthorizationRequest(BaseModel):
    agent_id: str
    action_id: str
    action_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)

class ActionAuthorizationResponse(BaseModel):
    is_authorized: bool
    reason: Optional[str] = None
    risk_score: Optional[float] = None

class GovernanceProposalRequest(BaseModel):
    proposer_id: str
    changes: Dict[str, Any]

class GovernanceProposalResponse(BaseModel):
    accepted: bool
    proposal_id: Optional[str] = None

class BudgetEvaluationRequest(BaseModel):
    agent_id: str
    action_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)

class BudgetEvaluationResponse(BaseModel):
    has_funds: bool
    balance: Optional[float] = None

class SimulationRequest(BaseModel):
    agent_id: str
    action_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)

class SimulationResponse(BaseModel):
    impact_score: float
    details: Dict[str, Any] = Field(default_factory=dict)

class ScoringResult(BaseModel):
    action_score: float
    threshold_met: bool

class CoordinationMessage(BaseModel):
    sender_id: str
    action: ActionAuthorizationRequest
    recipients: Optional[List[str]] = None

class CoordinationResult(BaseModel):
    success: bool
    nodes_notified: int

class GovernanceRecord(BaseModel):
    agent_id: str
    action: ActionAuthorizationRequest
    action_score: float
    timestamp: Optional[str] = None

class GovernanceResult(BaseModel):
    recorded: bool
    record_id: Optional[str] = None

class TaskProposal(BaseModel):
    task_id: str
    description: str
    required_capabilities: List[str] = Field(default_factory=list)

class TaskFormationResult(BaseModel):
    formed: bool
    assigned_agents: List[str] = Field(default_factory=list)

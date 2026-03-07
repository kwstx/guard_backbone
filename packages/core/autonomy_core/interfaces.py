from abc import ABC, abstractmethod
from autonomy_core.schemas.models import (
    AgentRegistrationRequest, AgentRegistrationResponse,
    VerificationResult, ActionAuthorizationRequest, ActionAuthorizationResponse,
    GovernanceProposalRequest, GovernanceProposalResponse,
    BudgetEvaluationRequest, BudgetEvaluationResponse,
    SimulationRequest, SimulationResponse,
    ScoringResult, CoordinationMessage, CoordinationResult,
    GovernanceRecord, GovernanceResult, TaskProposal, TaskFormationResult
)

# ====== Interfaces ====== #

class IdentityProvider(ABC):
    @abstractmethod
    async def verify(self, agent_id: str) -> VerificationResult:
        pass
        
    @abstractmethod
    async def register(self, request: AgentRegistrationRequest) -> AgentRegistrationResponse:
        pass


class EnforcementEngine(ABC):
    @abstractmethod
    async def validate(self, request: ActionAuthorizationRequest) -> ActionAuthorizationResponse:
        pass


class EconomicPolicyEngine(ABC):
    @abstractmethod
    async def has_funds(self, request: BudgetEvaluationRequest) -> BudgetEvaluationResponse:
        pass


class SimulationEngine(ABC):
    @abstractmethod
    async def predict_impact(self, request: SimulationRequest) -> SimulationResponse:
        pass


class ScoringEngine(ABC):
    @abstractmethod
    async def calculate_score(self, action: ActionAuthorizationRequest, impact_score: float) -> ScoringResult:
        pass


class CoordinationEngine(ABC):
    @abstractmethod
    async def notify_peers(self, message: CoordinationMessage) -> CoordinationResult:
        pass


class GovernanceEngine(ABC):
    @abstractmethod
    async def record_action(self, record: GovernanceRecord) -> GovernanceResult:
        pass

    @abstractmethod
    async def submit_proposal(self, request: GovernanceProposalRequest) -> GovernanceProposalResponse:
        pass


class TaskFormationEngine(ABC):
    @abstractmethod
    async def form_task(self, proposal: TaskProposal) -> TaskFormationResult:
        pass

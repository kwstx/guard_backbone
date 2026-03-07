from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class StateStore(ABC):
    """Contract for state persistence across the autonomy system."""

    @abstractmethod
    async def save_agent(self, agent_id: str, agent_data: Dict[str, Any]) -> None:
        pass

    @abstractmethod
    async def get_agent(self, agent_id: str) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    async def save_proposal(self, proposal_id: str, proposal_data: Dict[str, Any]) -> None:
        pass

    @abstractmethod
    async def get_proposal(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    async def save_decision(self, decision_id: str, decision_data: Dict[str, Any]) -> None:
        pass

    @abstractmethod
    async def get_decision(self, decision_id: str) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    async def save_audit_event(self, event_id: str, event_data: Dict[str, Any]) -> None:
        pass

    @abstractmethod
    async def get_audit_events(self) -> List[Dict[str, Any]]:
        pass

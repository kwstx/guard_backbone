import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from .interfaces import StateStore

class InMemoryStateStore(StateStore):
    def __init__(self):
        self.agents: Dict[str, Dict[str, Any]] = {}
        self.proposals: Dict[str, Dict[str, Any]] = {}
        self.decisions: Dict[str, Dict[str, Any]] = {}
        self.audit_events: Dict[str, Dict[str, Any]] = {}

    async def save_agent(self, agent_id: str, agent_data: Dict[str, Any]) -> None:
        self.agents[agent_id] = agent_data

    async def get_agent(self, agent_id: str) -> Optional[Dict[str, Any]]:
        return self.agents.get(agent_id)

    async def save_proposal(self, proposal_id: str, proposal_data: Dict[str, Any]) -> None:
        self.proposals[proposal_id] = proposal_data

    async def get_proposal(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        return self.proposals.get(proposal_id)

    async def save_decision(self, decision_id: str, decision_data: Dict[str, Any]) -> None:
        self.decisions[decision_id] = decision_data

    async def get_decision(self, decision_id: str) -> Optional[Dict[str, Any]]:
        return self.decisions.get(decision_id)

    async def save_audit_event(self, event_id: str, event_data: Dict[str, Any]) -> None:
        self.audit_events[event_id] = event_data

    async def get_audit_events(self) -> List[Dict[str, Any]]:
        return list(self.audit_events.values())


class FileStateStore(StateStore):
    def __init__(self, base_path: str = "./state_data"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

        for subdir in ["agents", "proposals", "decisions", "audit_events"]:
            (self.base_path / subdir).mkdir(parents=True, exist_ok=True)

    def _get_path(self, collection: str, item_id: str) -> Path:
        return self.base_path / collection / f"{item_id}.json"

    def _read_json(self, path: Path) -> Optional[Dict[str, Any]]:
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_json(self, path: Path, data: Dict[str, Any]) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    async def save_agent(self, agent_id: str, agent_data: Dict[str, Any]) -> None:
        self._write_json(self._get_path("agents", agent_id), agent_data)

    async def get_agent(self, agent_id: str) -> Optional[Dict[str, Any]]:
        return self._read_json(self._get_path("agents", agent_id))

    async def save_proposal(self, proposal_id: str, proposal_data: Dict[str, Any]) -> None:
        self._write_json(self._get_path("proposals", proposal_id), proposal_data)

    async def get_proposal(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        return self._read_json(self._get_path("proposals", proposal_id))

    async def save_decision(self, decision_id: str, decision_data: Dict[str, Any]) -> None:
        self._write_json(self._get_path("decisions", decision_id), decision_data)

    async def get_decision(self, decision_id: str) -> Optional[Dict[str, Any]]:
        return self._read_json(self._get_path("decisions", decision_id))

    async def save_audit_event(self, event_id: str, event_data: Dict[str, Any]) -> None:
        self._write_json(self._get_path("audit_events", event_id), event_data)

    async def get_audit_events(self) -> List[Dict[str, Any]]:
        events = []
        events_dir = self.base_path / "audit_events"
        for file_path in events_dir.glob("*.json"):
            data = self._read_json(file_path)
            if data is not None:
                events.append(data)
        return events

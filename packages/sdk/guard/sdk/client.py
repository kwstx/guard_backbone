import urllib.request
import urllib.error
import json
import asyncio
import uuid
from typing import Optional, Dict, Any

from guard.core import AutonomyConfig, AutonomyContainer, AutonomyCore
from guard.core.schemas.models import (
    AgentRegistrationRequest, ActionAuthorizationRequest, GovernanceProposalRequest
)
from guard.core.exceptions import AutonomyException

from .exceptions import (
    AutonomySDKError,
    AgentRegistrationError,
    ActionAuthorizationError,
    ClientConnectionError,
    ProposalError
)

class AutonomyClient:
    """
    The main entry point for external developers to interact with the Autonomy System.
    Wraps AutonomyCore to hide internal complexity and expose high-level security checks,
    using native Python types rather than internal Pydantic models.
    """
    def __init__(self, config: Optional[Dict[str, Any]] = None, api_version: str = "v1", server_url: Optional[str] = None):
        """
        Initialize the AutonomyClient.
        
        Args:
            config: Optional dict of configuration parameters for the core system.
            api_version: The API version to specify in requests.
            server_url: The URL of a remote autonomy server. If not provided, an in-memory AutonomyCore is used.
            
        Example:
            ```python
            from guard.sdk import AutonomyClient
            
            # Using an in-memory local core processing engine
            client = AutonomyClient()
            
            # Alternatively, connecting to a remote autonomy cluster
            remote_client = AutonomyClient(server_url="http://node.autonomy.local")
            ```
        """
        self.config = config or {}
        self.api_version = api_version
        self.server_url = server_url
        
        # Prepare context for requests (could be passed to HTTP client later)
        self._request_headers = {"X-API-Version": self.api_version, "Content-Type": "application/json"}
        
        # Only initialize local core if no server URL is provided
        if not self.server_url:
            try:
                container = AutonomyContainer(_to_autonomy_config(self.config))
                self._core: Optional[AutonomyCore] = container.build_core()
            except Exception as e:
                raise AutonomySDKError(f"Failed to initialize local AutonomyCore: {e}") from e
        else:
            self._core: Optional[AutonomyCore] = None

    async def authorize(
        self,
        agent_id: str,
        action_id: str,
        action_type: str,
        payload: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Check if an agent is authorized to perform a specific action via REST API.
        """
        payload = payload or {}
        req_obj = ActionAuthorizationRequest(
            agent_id=agent_id,
            action_id=action_id,
            action_type=action_type,
            payload=payload
        )
        body_bytes = req_obj.model_dump_json().encode('utf-8')

        if self.server_url:
            req = urllib.request.Request(
                f"{self.server_url}/authorize_action",
                data=body_bytes,
                headers=self._request_headers,
                method="POST"
            )
            try:
                # Use a separate thread for the synchronous urlopen if needed, 
                # but for simplicity we'll assume this runs in an environment where blocking is okay or use asyncio.to_thread
                with urllib.request.urlopen(req) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    return data.get("is_authorized", False)
            except Exception as e:
                raise ActionAuthorizationError(f"Error calling remote server: {e}") from e
        else:
            if not self._core:
                raise AutonomySDKError("Core Engine is not initialized locally.")
            result = await self._core.authorize_action(req_obj)
            return result.is_authorized

    def authorize_sync(
        self,
        agent_id: str,
        action_id: str,
        action_type: str,
        payload: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Synchronous wrapper for authorize.
        
        Example:
            ```python
            client.authorize_sync("Agent_A", "action_1", "read_file", {"path": "/data.txt"})
            ```
        """
        return asyncio.run(self.authorize(agent_id, action_id, action_type, payload))

    async def authorize_action(
        self,
        agent_id: str,
        action_id: str,
        action_type: str,
        payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Check if an agent is authorized via REST API and return full details.
        """
        payload = payload or {}
        req_obj = ActionAuthorizationRequest(
            agent_id=agent_id,
            action_id=action_id,
            action_type=action_type,
            payload=payload
        )
        body_bytes = req_obj.model_dump_json().encode('utf-8')

        if self.server_url:
            req = urllib.request.Request(
                f"{self.server_url}/authorize_action",
                data=body_bytes,
                headers=self._request_headers,
                method="POST"
            )
            try:
                with urllib.request.urlopen(req) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    # Normalize response to include decision and risk_score
                    data.setdefault("risk_score", 0.0)
                    data.setdefault("decision", "APPROVED" if data.get("is_authorized") else "DENIED")
                    return data
            except Exception as e:
                raise ActionAuthorizationError(f"Error calling remote server: {e}") from e
        else:
            if not self._core:
                raise AutonomySDKError("Core Engine is not initialized locally.")
            result = await self._core.authorize_action(req_obj)
            return result.model_dump()

    def authorize_action_sync(
        self,
        agent_id: str,
        action_id: str,
        action_type: str,
        payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Synchronous wrapper for authorize_action.
        """
        return asyncio.run(self.authorize_action(agent_id, action_id, action_type, payload))

    async def register_agent(
        self,
        agent_id: str,
        name: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Register a new agent in the system.
        
        Args:
            agent_id: The unique ID for the agent.
            name: Optional human-readable name for the agent.
            attributes: Optional dictionary of attributes describing the agent.
            
        Returns:
            The unique agent ID if successful.
        
        Raises:
            AgentRegistrationError: If agent registration fails.
            ClientConnectionError: If the remote server cannot be reached.
            
        Example:
            ```python
            new_id = await client.register_agent(
                agent_id="AgentZero",
                name="System Administrator Bot",
                attributes={"clearance": "level_5"}
            )
            ```
        """
        attributes = attributes or {}
        req_obj = AgentRegistrationRequest(
            agent_id=agent_id,
            name=name,
            attributes=attributes
        )
        body_bytes = req_obj.model_dump_json().encode('utf-8')

        if self.server_url:
            req = urllib.request.Request(
                f"{self.server_url}/register_agent",
                data=body_bytes,
                headers=self._request_headers,
                method="POST"
            )
            try:
                with urllib.request.urlopen(req) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    return data.get("agent_id", "")
            except urllib.error.URLError as e:
                raise ClientConnectionError(f"Error calling remote server: {e}") from e
            except Exception as e:
                raise AgentRegistrationError(f"Unexpected error calling registration server: {e}") from e
        else:
            if not self._core:
                raise AutonomySDKError("Core Engine is not initialized locally.")
            try:
                return await self._core.register_agent(req_obj)
            except AutonomyException as e:
                raise AgentRegistrationError(f"Registration failed internally: {str(e)}") from e
            except Exception as e:
                raise AgentRegistrationError(f"Unexpected internal registration error: {str(e)}") from e

    def register_agent_sync(
        self,
        agent_id: str,
        name: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Synchronous wrapper for register_agent.
        
        Example:
            ```python
            client.register_agent_sync("AgentZero", name="System Admin")
            ```
        """
        return asyncio.run(self.register_agent(agent_id, name, attributes))

    async def propose_change(self, proposer_id: str, changes: Dict[str, Any]) -> bool:
        """
        Propose a change to the system governance or configuration.
        
        Args:
            proposer_id: The ID of the agent proposing the change.
            changes: A dictionary detailing the proposed changes.
            
        Returns:
            True if the proposal is successfully submitted, False otherwise.
            
        Raises:
            ProposalError: If the proposal cannot be processed by the core.
            
        Example:
            ```python
            success = await client.propose_change(
                proposer_id="AgentZero",
                changes={"max_budget": 5000}
            )
            if success:
                print("Governance change successfully submitted for vote!")
            ```
        """
        req_obj = GovernanceProposalRequest(proposer_id=proposer_id, changes=changes)
        
        if self.server_url:
            req = urllib.request.Request(
                f"{self.server_url}/propose_change",
                data=req_obj.model_dump_json().encode('utf-8'),
                headers=self._request_headers,
                method="POST"
            )
            try:
                with urllib.request.urlopen(req) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    return data.get("success", False)
            except urllib.error.URLError as e:
                raise ClientConnectionError(f"Error calling remote server: {e}") from e
            except urllib.error.HTTPError as e:
                raise ProposalError(f"HTTP Error calling proposal server: {e.code} - {e.reason}") from e
            except Exception as e:
                raise ProposalError(f"Unexpected error calling proposal server: {e}") from e
        else:
            if not self._core:
                raise AutonomySDKError("Core Engine is not initialized locally.")
            try:
                return await self._core.propose_change(req_obj)
            except AutonomyException as e:
                raise ProposalError(f"Proposal failed internally: {str(e)}") from e
            except Exception as e:
                raise ProposalError(f"Unexpected internal proposal error: {str(e)}") from e

    def propose_change_sync(self, proposer_id: str, changes: Dict[str, Any]) -> bool:
        """
        Synchronous wrapper for propose_change.
        
        Example:
            ```python
            client.propose_change_sync("Agent_X", {"settings.debug": True})
            ```
        """
        return asyncio.run(self.propose_change(proposer_id, changes))

    def get_system_status(self) -> Dict[str, Any]:
        """
        Returns a high-level status of the autonomy system.
        
        Example:
            ```python
            print(client.get_system_status())
            # {'status': 'active', 'version': '1.0.0', 'connected': True}
            ```
        """
        return {
            "version": "1.0.0-guard",
            "security_modules": {
                "Identity": "healthy",
                "Enforcement": "healthy",
                "Economics": "healthy",
                "Simulation": "healthy",
                "Scoring": "healthy"
            }
        }


def _to_autonomy_config(config: Dict[str, Any]) -> AutonomyConfig:
    """Helper to convert a dictionary to an AutonomyConfig securely."""
    if not config:
        return AutonomyConfig()
    defaults = AutonomyConfig()
    return AutonomyConfig(
        risk_thresholds=config.get("risk_thresholds", defaults.risk_thresholds),
        budget_limits=config.get("budget_limits", defaults.budget_limits),
        governance_rules=config.get("governance_rules", defaults.governance_rules),
        enabled_modules=config.get("enabled_modules", defaults.enabled_modules),
        state_backend=config.get("state_backend", defaults.state_backend),
        implementations=config.get("implementations", defaults.implementations),
        module_options=config.get("module_options", defaults.module_options),
    )

import re
import json
import logging
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Set

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
from guard.logic.models.policy_schema import (
    StructuredPolicy, 
    LogicalCondition, 
    ConditionOperator, 
    ActionTrigger,
    ExceptionHandler
)

class EnforcementResult(BaseModel):
    """Result of policy enforcement on a specific state or action."""
    policy_id: str
    is_allowed: bool = True
    triggered_actions: List[ActionTrigger] = Field(default_factory=list)
    instructions: List[str] = Field(default_factory=list)
    violations: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class PolicyEnforcer:
    """
    Protocol Gateway that delegates policy evaluation to the deterministic OPA engine.
    """
    
    def __init__(self, opa_client: Optional["OpaClient"] = None):
        self.opa_client = opa_client or OpaClient()

    def evaluate(self, state: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> EnforcementResult:
        """
        Delegates policy evaluation to the deterministic OPA engine.
        :param state: The current system or agent state (treated as payload).
        :param context: Additional context (must contain agent_id and action_type).
        :return: An EnforcementResult based on OPA's deterministic output.
        """
        context = context or {}
        agent_id = context.get("agent_id", "unknown_agent")
        action_type = context.get("action_type", "unknown_action")
        
        is_allowed = self.opa_client.query_policy(
            agent_id=agent_id,
            action_type=action_type,
            payload=state
        )
        
        return EnforcementResult(
            policy_id="opa_system_policy",
            is_allowed=is_allowed,
            metadata={
                "source": "opa_engine",
                "agent_id": agent_id,
                "action_type": action_type
            }
        )


class OpaClient:
    """
    Client to query the local Open Policy Agent (OPA) server for policy enforcement.
    Fails closed (DENY) on any errors or timeouts to maintain a Failsafe posture.
    """
    
    def __init__(self, endpoint_url: str = "http://localhost:8181/v1/data/system/rules/allow", timeout_seconds: float = 2.0):
        self.endpoint_url = endpoint_url
        self.timeout = timeout_seconds

    def query_policy(self, agent_id: str, action_type: str, payload: Dict[str, Any]) -> bool:
        """
        Queries OPA to evaluate whether the requested action is permitted.
        Returns True if allowed, False otherwise (Failsafe).
        """
        input_payload = {
            "agent_id": agent_id,
            "action_type": action_type,
            "payload": payload
        }
        
        # Merge payload properties into the top level for rules expecting e.g. input.agent_level
        if isinstance(payload, dict):
            for k, v in payload.items():
                if k not in ("agent_id", "action_type", "payload"):
                    input_payload[k] = v
                    
        input_data = {
            "input": input_payload
        }
        
        try:
            req = urllib.request.Request(
                self.endpoint_url,
                data=json.dumps(input_data, default=str).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                if response.status != 200:
                    logger.warning(f"OPA server returned status {response.status}. Defaulting to DENY.")
                    return False
                
                response_body = response.read().decode("utf-8")
                result_data = json.loads(response_body)
                
                # OPA typically wraps responses in a 'result' field
                result = result_data.get("result", False)
                
                if isinstance(result, bool):
                    return result
                if isinstance(result, dict) and "allow" in result:
                    return bool(result.get("allow", False))
                
                return bool(result)
                
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, Exception) as e:
            logger.error(f"Error communicating with OPA server: %s. Defaulting to DENY.", e)
            return False

import functools
import asyncio
import uuid
from typing import Callable, Any, Optional

from .exceptions import AutonomySDKError

class CircuitBreakerException(AutonomySDKError):
    """Raised when an action is blocked by the Circuit Breaker middleware due to high risk."""
    pass

def circuit_breaker(client, agent_id: str, action_type: str, threshold: float = 85.0):
    """
    Middleware that acts as a circuit breaker for AutonomyClient.
    
    If the authorize_action call returns a risk score above the threshold,
    it wraps the target function in an exception (CircuitBreakerException) 
    that physically prevents the function (e.g., a network request or DB write) 
    from executing.
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            action_id = str(uuid.uuid4())
            # Prepare payload from arguments for context, if necessary
            payload = {"args": str(args), "kwargs": str(kwargs)}
            
            response = await client.authorize_action(
                agent_id=agent_id,
                action_id=action_id,
                action_type=action_type,
                payload=payload
            )
            
            # Extract risk_score or fallback to impact_score
            if isinstance(response, dict):
                risk_score = response.get("risk_score", response.get("impact_score", 0.0))
            else:
                risk_score = getattr(response, "risk_score", getattr(response, "impact_score", 0.0))
            
            if float(risk_score) > threshold:
                raise CircuitBreakerException(
                    f"Action '{action_type}' blocked: Risk score {risk_score} exceeds threshold {threshold}"
                )
                
            return await func(*args, **kwargs)

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            action_id = str(uuid.uuid4())
            payload = {"args": str(args), "kwargs": str(kwargs)}
            
            response = client.authorize_action_sync(
                agent_id=agent_id,
                action_id=action_id,
                action_type=action_type,
                payload=payload
            )
            
            # Extract risk_score or fallback to impact_score
            if isinstance(response, dict):
                risk_score = response.get("risk_score", response.get("impact_score", 0.0))
            else:
                risk_score = getattr(response, "risk_score", getattr(response, "impact_score", 0.0))
            
            if float(risk_score) > threshold:
                raise CircuitBreakerException(
                    f"Action '{action_type}' blocked: Risk score {risk_score} exceeds threshold {threshold}"
                )
                
            return func(*args, **kwargs)

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    return decorator

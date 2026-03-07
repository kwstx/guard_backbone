import re
from typing import Any, Dict, List, Optional, Set
from pydantic import BaseModel, Field
from actionable_logic.models.policy_schema import (
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
    Evaluates StructuredPolicy objects against real-time agent states and actions.
    Enforces constraints and returns actionable triggers.
    """
    
    def __init__(self, policies: List[StructuredPolicy] = None):
        self.policies = policies or []

    def add_policy(self, policy: StructuredPolicy):
        self.policies.append(policy)

    def evaluate(self, state: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> List[EnforcementResult]:
        """
        Evaluates all registered policies against the provided state.
        :param state: The current system or agent state.
        :param context: Additional context (e.g., agent_id, mission_goals).
        :return: A list of EnforcementResult objects.
        """
        results = []
        for policy in self.policies:
            result = self.evaluate_single_policy(policy, state, context)
            results.append(result)
        return results

    def evaluate_single_policy(self, policy: StructuredPolicy, state: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> EnforcementResult:
        """Evaluates a single policy against the state."""
        violations = []
        is_allowed = True
        
        # 1. Check Exceptions (if any exception matches, we might skip enforcement or change behavior)
        for exception in policy.exceptions:
            if self._matches_exception(exception, state, context):
                if exception.override_action == "ignore":
                    return EnforcementResult(
                        policy_id=policy.policy_id, 
                        is_allowed=True, 
                        metadata={"exception_applied": exception.condition}
                    )
                elif exception.override_action == "log_only":
                    # We continue but maybe flag it
                    pass

        # 2. Evaluate Conditions
        for condition in policy.conditions:
            if not self._evaluate_condition(condition, state):
                # If a condition is NOT met, it depends on how triggers are defined.
                # Usually, triggers are "on_violation".
                # But sometimes conditions define the "allowed" space.
                # Let's assume if conditions are met, the policy is ACTIVE.
                pass
        
        # In a more robust implementation, we might distinguish between 
        # "pre-conditions" and "constraints".
        # For now, let's assume if conditions are met, we check for violations.
        # Actually, let's treat conditions as "Activators". 
        # If conditions are met, the policy is "Active" and its instructions/triggers apply.
        
        conditions_met = all(self._evaluate_condition(c, state) for c in policy.conditions) if policy.conditions else True
        
        triggered_actions = []
        if conditions_met:
            # Policy is active.
            # Triggers that are 'on_activation' should fire.
            triggered_actions.extend([t for t in policy.triggers if t.trigger_type == "on_activation"])
            
            # If there are specific instructions, they are constraints for the agent.
            return EnforcementResult(
                policy_id=policy.policy_id,
                is_allowed=True,
                triggered_actions=triggered_actions,
                instructions=policy.instructions,
                metadata={"status": "active"}
            )
        else:
            # Policy conditions not met, so it doesn't currently constrain the agent.
            return EnforcementResult(
                policy_id=policy.policy_id,
                is_allowed=True,
                metadata={"status": "inactive"}
            )

    def _evaluate_condition(self, condition: LogicalCondition, state: Dict[str, Any]) -> bool:
        """Evaluates a single logic condition against the state."""
        if condition.parameter not in state:
            return False
        
        actual_value = state[condition.parameter]
        target_value = condition.value
        op = condition.operator

        try:
            if op == ConditionOperator.EQ:
                return actual_value == target_value
            elif op == ConditionOperator.NE:
                return actual_value != target_value
            elif op == ConditionOperator.GT:
                return actual_value > target_value
            elif op == ConditionOperator.LT:
                return actual_value < target_value
            elif op == ConditionOperator.GE:
                return actual_value >= target_value
            elif op == ConditionOperator.LE:
                return actual_value <= target_value
            elif op == ConditionOperator.CONTAINS:
                return target_value in actual_value
            elif op == ConditionOperator.MATCHES:
                return bool(re.search(str(target_value), str(actual_value)))
        except (TypeError, ValueError):
            return False
            
        return False

    def _matches_exception(self, exception: ExceptionHandler, state: Dict[str, Any], context: Optional[Dict[str, Any]]) -> bool:
        """
        Checks if an exception handler is applicable.
        Currently supports simple key-value matching in context.
        """
        if not context:
            return False
        
        # Simple implementation: 'agent_id == "admin"' or 'override == True'
        # For now, let's do a simple string match in the exception condition against context keys or values
        # In a real system, this would be a mini DSL parser.
        cond = exception.condition.lower()
        for k, v in context.items():
            if f"{k} == {v}".lower() in cond or f"{k}=={v}".lower() in cond:
                return True
            if str(v).lower() in cond: # Dangerous but simple for demo
                return True
        return False

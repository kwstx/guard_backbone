"""
Autonomy Core Exceptions
"""

class AutonomyException(Exception):
    """Base exception for all autonomy core errors."""
    pass

class IdentityError(AutonomyException):
    pass

class EnforcementError(AutonomyException):
    pass

class BudgetViolationError(AutonomyException):
    pass

class GovernanceRejectionError(AutonomyException):
    pass

class SimulationFailure(AutonomyException):
    pass

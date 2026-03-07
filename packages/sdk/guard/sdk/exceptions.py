class AutonomySDKError(Exception):
    """Base exception for all Autonomy SDK errors."""
    pass

class AgentRegistrationError(AutonomySDKError):
    """Raised when an agent cannot be registered."""
    pass

class ActionAuthorizationError(AutonomySDKError):
    """Raised when an action cannot be authorized or an error occurs during authorization."""
    pass

class ClientConnectionError(AutonomySDKError):
    """Raised when the SDK cannot connect to the Autonomy Server."""
    pass

class ProposalError(AutonomySDKError):
    """Raised when a governance proposal fails."""
    pass

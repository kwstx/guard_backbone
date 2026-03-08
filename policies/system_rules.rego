package system.rules

# A max_allowed variable for budget constraint
max_allowed := 1000

# Default-deny policy
default allow := false

# Rule that allows actions only if conditions are met
allow if {
    input.agent_level > 0
    input.requested_budget < max_allowed
}

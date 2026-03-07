# PolicyAPI Documentation

The `PolicyAPI` provides a structured interface for external systems and autonomous agents to interact with the Policy Repository, perform simulations, and ensure compliance.

## Endpoints

### 1. Repository Management

*   **`GET /policies`**: Lists policies with optional filters (`industry`, `compliance_type`, `functional_area`, `is_template`).
*   **`POST /policies`**: Pushes a new `StructuredPolicy` to the repository.
*   **`GET /policies/{policy_id}`**: Retrieves a specific policy by ID and version.

### 2. Compliance & Auditing

*   **`GET /compliance/traces/{agent_id}`**: Returns the history of policy adoptions and compliance scores for a specific agent.
*   **`GET /audit/{policy_id}`**: Provides a complete historical trace of deployments for a specific policy.

### 3. Simulation & Hypotheticals

*   **`POST /simulate`**: Evaluates a hypothetical policy against a provided system state.
    *   **Request**:
        ```json
        {
          "policy": { ...StructuredPolicy... },
          "test_state": { "parameter": "value" },
          "context": { "agent_id": "..." }
        }
        ```
    *   **Response**: Includes `is_active`, `triggered_actions`, `instructions`, and a `causal_explanation` detailing why the policy was or wasn't activated.

### 4. Live Agent Integration

*   **`POST /check-action`**: The primary hook for live agents. Before executing an action, an agent can send the action details here to receive a guardrail response.
    *   **Request**:
        ```json
        {
          "agent_id": "agent-123",
          "action": { "type": "transfer", "amount": 1000 },
          "context": { "trust_score": 0.9 }
        }
        ```
    *   **Response**: Returns an action suggestion (`allow`, `escalate`, `correct`, `block`, `reroute`) and the reason based on active policies.

## Running the API

To start the API server locally:

```bash
uvicorn src.api.main:app --reload --port 8000
```

The interactive API documentation will be available at `http://localhost:8000/docs`.

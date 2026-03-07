# Actionable Logic

Actionable Logic is a framework for converting high-level governance policies into executable constraints for autonomous agents. It provides a complete lifecycle for policy management, including translation from natural language, versioned storage, real-time enforcement through adaptive guardrails, and detailed compliance auditing.

## Core Components

### 1. Policy Translation
Converts natural language policy descriptions into structured, machine-readable objects. This ensures that human-readable intent is preserved while providing agents with the explicit logic required for autonomous execution.

*   **Location**: `src/translator/`
*   **Key Features**: Heuristic and LLM-driven translation, logic extraction, and validation.

### 2. Policy Repository
A versioned storage system for policies and templates. It supports indexing by industry, compliance type, and functional area, allowing for rapid adaptation of existing governance frameworks.

*   **Location**: `src/repository/`
*   **Key Features**: Versioning, template cloning, and multi-criteria metadata search.

### 3. Adaptive Guardrails Engine
Monitors agent actions in real-time against active policies. It detects violations and conflicts, providing corrective suggestions or blocking prohibited actions before they are executed.

*   **Location**: `src/enforcement/`
*   **Key Features**: Real-time monitoring, conflict detection, and automated corrective actions.

### 4. Version Control Engine
Tracks the deployment and adoption of policy updates across an agent ecosystem. It maintains a historical trace of all changes for auditing and enables safe rollbacks of governance configurations.

*   **Location**: `src/version_control/`
*   **Key Features**: Adoption tracking, compliance impact assessment, and full audit trails.

### 5. Policy API
A centralized interface for external systems and agents to interact with the framework. It supports policy management, compliance tracing, and counterfactual simulations.

*   **Location**: `src/api/`
*   **Key Features**: RESTful endpoints, interactive documentation via FastAPI, and simulation hooks.

## Installation

Ensure you have Python 3.10 or higher installed.

1. Clone the repository.
2. Install the required dependencies:

```bash
pip install -r requirements.txt
```

## Quick Start

### Running the API
To start the Policy API server:

```bash
uvicorn src.api.main:app --reload --port 8000
```

The interactive documentation will be available at `http://localhost:8000/docs`.

### API Overview

*   **`GET /policies`**: Query established policies and templates.
*   **`POST /policies`**: Upload a new structured policy.
*   **`POST /simulate`**: Test a policy against a system state without deploying.
*   **`POST /check-action`**: Live hook for agents to verify actions against guardrails.
*   **`GET /compliance/traces/{agent_id}`**: Retrieve historical compliance data.

### Basic Usage

#### Translation and Storage
Example of translating a policy and saving it to the repository:

```python
from src.translator.core import PolicySchemaTranslator
from src.repository.policy_repository import PolicyRepository

translator = PolicySchemaTranslator()
repo = PolicyRepository("sqlite:///policies.db")

# Translate natural language to a structured object
policy = translator.translate("All high-value transfers require a trust score above 0.8")

# Save to repository
repo.save_policy(policy)
```

#### Action Monitoring
Example of checking an agent action against active guardrails:

```python
from src.enforcement.guardrails import AdaptiveGuardrailsEngine

guardrails = AdaptiveGuardrailsEngine()

# Monitor a proposed action
response = guardrails.monitor_action(
    agent_id="agent-001",
    action={"type": "transfer", "amount": 5000}
)

print(response["suggestion"])
```

## Testing

Run the test suite using `pytest`:

```bash
pytest
```

## Requirements

- Python 3.10+
- Pydantic 2.0+
- FastAPI
- SQLAlchemy
- Uvicorn

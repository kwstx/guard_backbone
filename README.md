<p align="center">
  <strong>Guard Backbone</strong>
</p>

<p align="center">
  <em>Sovereign Core — The Runtime Firewall for AI Agents</em>
</p>

<p align="center">
  <a href="#what-is-it">Overview</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#packages">Packages</a> •
  <a href="#api-reference">API Reference</a> •
  <a href="#sdk-usage">SDK Usage</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#security-model">Security Model</a> •
  <a href="#testing">Testing</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## What is it?

**Guard Backbone** is a production-grade, open-source security infrastructure that acts as a **runtime firewall for autonomous AI agents**. It sits between an AI agent and the outside world — every action an agent attempts, whether reading a file, transferring funds, provisioning cloud infrastructure, or calling an external API, must pass through a **Sovereign Safety Loop** that evaluates cryptographic identity, externalized policy compliance, real-world budget constraints, deterministic infrastructure impact, and multi-dimensional risk scoring **before the action is allowed to execute**.

If the risk is too high, the action is **blocked before it happens**. If the system itself fails, the action is **blocked by default**. No exceptions.

Guard Backbone is **not a wrapper around an LLM's safety features**. LLMs are non-deterministic — the same prompt can produce different outputs, and prompt injection can bypass model-level guardrails entirely. Guard Backbone operates at the **infrastructure layer**, providing deterministic, auditable, cryptographically verifiable enforcement that no agent can circumvent because it controls the network path the agent must traverse.

### The Core Problem

As AI agents become more capable and autonomous, the question shifts from *"Can the agent do this?"* to **"Should the agent be allowed to do this?"** Guard Backbone provides a deterministic, auditable answer to that question — enforced at the network level, backed by cryptographic identity, real financial ledgers, and immutable audit trails.

### Key Capabilities

| Capability | Description |
|---|---|
| **Cryptographic Identity (SPIFFE/SPIRE)** | Agents authenticate via X.509 SVIDs — cryptographically signed identity documents verified against a trusted SPIRE server. No string-based IDs, no spoofing |
| **Externalized Policy Engine (OPA)** | All policy logic is defined in Rego and evaluated by Open Policy Agent. Policies are auditable, version-controlled, and decoupled from application code |
| **Real Financial Controls (Stripe)** | Budget verification queries the Stripe API in real-time. Agents are mapped to Stripe customer records; fund checks use actual account balances, not mock counters |
| **Deterministic Impact Simulation (Terraform)** | Infrastructure-modifying actions trigger a `terraform plan` against a sandbox. The system counts resource deletions, modifications, and creations to calculate a deterministic "Physical Blast Radius" score |
| **Multi-Dimensional Risk Scoring** | Nine-axis risk scoring across operational, regulatory, financial, reputational, strategic, compliance, simulation, opportunity-cost, and system-stability dimensions with adaptive calibration |
| **Network-Level Kill-Switch (Envoy Proxy)** | All agent network traffic is intercepted by an Envoy proxy. An `ext_authz` filter routes every request through the Backbone for authorization before it reaches the internet |
| **Tamper-Evident Audit Ledger** | Every authorization decision is recorded in a SHA-256 hash-chained ledger. Each record includes the hash of its predecessor — any modification or deletion breaks the chain and is immediately detectable |
| **Circuit Breaker Middleware** | SDK-level decorator that physically prevents high-risk function calls from executing. If the risk score exceeds a configurable threshold, a `SecurityViolation` is raised before the function body runs |
| **Default-Deny Failsafe** | Any system failure — OPA unreachable, Stripe API timeout, Terraform crash — automatically results in action denial. The system never silently passes an action it cannot verify |

---

## Architecture

Guard Backbone follows a **modular monorepo** structure. The system is composed of independently versioned packages that communicate through well-defined abstract interfaces and a central dependency injection container. Production deployment uses Docker Compose to orchestrate the Gateway, OPA, and Envoy services into a network-level sandbox.

### Sovereign Safety Loop

Every agent action passes through **six sequential checkpoints**. Failure at any stage immediately terminates the loop with a denial.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SOVEREIGN SAFETY LOOP                          │
│                                                                        │
│  Agent Request                                                         │
│       │                                                                │
│       ▼                                                                │
│  ┌──────────────────┐    X.509 SVID parsed, trust domain               │
│  │ 1. SPIFFE/SPIRE  │    validated against SPIRE server.               │
│  │    Identity      │    Invalid cert → DENY                           │
│  └────────┬─────────┘                                                  │
│           ▼                                                            │
│  ┌──────────────────┐    Rego policy evaluated by Open Policy          │
│  │ 2. OPA Policy    │    Agent. Default-deny if OPA is                 │
│  │    Enforcement   │    unreachable. Policy violation → DENY          │
│  └────────┬─────────┘                                                  │
│           ▼                                                            │
│  ┌──────────────────┐    Agent's Stripe customer balance               │
│  │ 3. Stripe Budget │    queried in real-time.                         │
│  │    Verification  │    Insufficient funds → DENY                     │
│  └────────┬─────────┘                                                  │
│           ▼                                                            │
│  ┌──────────────────┐    terraform plan executed in sandbox.           │
│  │ 4. Terraform     │    Deletions, changes, creations counted.        │
│  │    Impact Sim    │    Physical Blast Radius calculated.             │
│  └────────┬─────────┘                                                  │
│           ▼                                                            │
│  ┌──────────────────┐    Nine-axis composite risk score                │
│  │ 5. Unified Risk  │    computed across all dimensions.               │
│  │    Scoring       │    Score > threshold → DENY                      │
│  └────────┬─────────┘                                                  │
│           ▼                                                            │
│  ┌──────────────────┐                                                  │
│  │ 6. Decision Gate │─── APPROVE (risk ≤ threshold)                    │
│  │                  │─── DENY    (risk > threshold)                    │
│  └──────────────────┘                                                  │
│                                                                        │
│  Exception at ANY stage → Default-Deny (is_authorized=False)           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Network Sandbox Architecture

In production, agents do not have direct internet access. All outbound traffic is routed through an Envoy proxy that calls the Backbone's `ext_authz` endpoint before forwarding any request.

```
┌──────────┐     ┌─────────────┐     ┌─────────────────────┐     ┌───────────┐
│ AI Agent │────►│ Envoy Proxy │────►│ Guard Gateway       │     │ Internet  │
│          │     │ (port 8080) │     │ /ext_authz endpoint │     │           │
│          │     │             │◄────│ 200 OK / 403 DENIED │     │           │
│          │     │             │─────┼─────────────────────┼────►│           │
│          │     │             │     │                     │     │           │
└──────────┘     └─────────────┘     └──────────┬──────────┘     └───────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │    OPA Server       │
                                     │ (Rego policy eval)  │
                                     └─────────────────────┘
```

- **Envoy** intercepts all traffic on port `8080` and invokes the Gateway's `ext_authz` endpoint with a 500ms timeout.
- **`failure_mode_allow: false`** — if the Gateway is unreachable, Envoy **denies** the request. The system fails closed.
- The Gateway parses the `x-agent-id`, `x-target-url`, and `x-payload` headers, constructs an `ActionAuthorizationRequest`, and runs the full Sovereign Safety Loop.
- If approved, Envoy forwards the request to the original destination via dynamic forward proxy.

### Project Structure

```
guard-backbone/
├── apps/
│   └── gateway/                        # FastAPI gateway service (HTTP API)
│       ├── gateway_service/
│       │   ├── app.py                  # FastAPI app: /register_agent, /authorize_action,
│       │   │                           #   /ext_authz (Envoy filter), /propose_change, /health
│       │   ├── main.py                # Uvicorn entrypoint
│       │   └── models.py             # Gateway-specific Pydantic models
│       └── tests/
│           └── test_app.py            # Gateway integration tests
│
├── packages/
│   ├── core/                           # Security Kernel (Python)
│   │   └── guard/core/
│   │       ├── engine.py              # AutonomyCore (safety loop), TerraformSimulator,
│   │       │                          #   StripeEconomicPolicyEngine, SpiffeIdentityProvider
│   │       ├── config.py             # AutonomyConfig — frozen runtime configuration
│   │       ├── container.py          # AutonomyContainer — dependency injection
│   │       ├── interfaces.py         # Abstract interfaces for all security modules
│   │       ├── exceptions.py         # Typed exception hierarchy
│   │       ├── logger.py             # Structured JSON logging
│   │       ├── schemas/
│   │       │   └── models.py         # Pydantic request/response models
│   │       └── state/
│   │           ├── interfaces.py     # StateStore abstract contract
│   │           └── impl.py           # InMemory and File state backends
│   │
│   ├── sdk/                            # Python SDK for external integrations
│   │   └── guard/sdk/
│   │       ├── client.py             # AutonomyClient — developer-facing API
│   │       ├── middleware.py         # Circuit breaker decorator (risk_score based)
│   │       └── exceptions.py        # SDK-specific exceptions
│   │
│   ├── enforcement/                    # Multi-layer enforcement engine (TypeScript)
│   │   └── src/
│   │       ├── orchestrator/         # GuardrailOrchestrator — coordinates layers
│   │       ├── layers/
│   │       │   ├── pre-execution/    # Pre-execution validation + predictive risk
│   │       │   ├── in-process/       # Runtime monitoring + anomaly detection
│   │       │   ├── post-execution/   # Post-execution audit
│   │       │   ├── intervention/     # Adaptive intervention strategies
│   │       │   └── remediation/      # Rollback and remediation engine
│   │       └── core/
│   │           ├── models.ts         # Enforcement state machine & types
│   │           ├── event-bus.ts      # Internal enforcement event bus
│   │           ├── decision-log.ts   # Decision explanation logging
│   │           ├── threshold-adaptation-engine.ts
│   │           └── violation-propagation.ts
│   │
│   ├── logic/                          # Policy Logic Layer (Python)
│   │   └── guard/logic/
│   │       ├── enforcement/          # PolicyEnforcer (OPA Protocol Gateway) + OpaClient
│   │       ├── translator/           # NL-to-structured policy translation
│   │       ├── repository/           # SQLite-backed policy storage + TamperEvidentLedger
│   │       ├── universal_policy_parser/  # Multi-format policy parser
│   │       ├── live_update/          # Hot-reload policy engine
│   │       ├── version_control/      # Policy versioning, deployment & rollback
│   │       ├── extensibility/        # Template modules and validation
│   │       ├── feedback/             # Feedback connector for policy tuning
│   │       └── models/
│   │           └── policy_schema.py  # StructuredPolicy Pydantic model
│   │
│   ├── scoring/                        # Risk Scoring Engine (TypeScript)
│   │   └── src/
│   │       ├── RiskScoringEngine.ts              # Multi-dimensional risk scoring
│   │       ├── DecisionEvaluationFramework.ts     # Action-to-DecisionObject mapper
│   │       ├── ImpactSimulationModule.ts          # Forward impact simulation
│   │       ├── ClassificationEngine.ts            # Action classification
│   │       ├── ComplianceEstimator.ts             # Compliance lifecycle forecasting
│   │       ├── DecisionBlockingAPI.ts             # Blocking decision interface
│   │       ├── HistoricalFeedbackIntegrator.ts    # Feedback-based calibration
│   │       ├── HumanOverrideInterface.ts          # Human-in-the-loop support
│   │       ├── PreemptiveDetectionLayer.ts        # Early-warning detection
│   │       ├── PrometheusExporter.ts              # Prometheus metrics export
│   │       ├── ResourceAnalyzer.ts                # Resource usage analysis
│   │       ├── StrategicAlignmentModule.ts        # Strategic alignment evaluation
│   │       └── ThresholdOptimizationEngine.ts     # Dynamic threshold tuning
│   │
│   └── shared_utils/                   # Shared utilities (Python + TypeScript)
│       ├── shared_utils/
│       │   ├── logger.py             # Shared Python logger
│       │   └── metrics.py            # Shared metrics utilities
│       └── src/
│           ├── crypto.ts             # Cryptographic utilities
│           ├── logger.ts             # Shared TypeScript logger
│           └── types.ts              # Shared type definitions
│
├── policies/
│   └── system_rules.rego              # OPA Rego policy (default-deny + attribute rules)
│
├── docker-compose.yaml                # Gateway + OPA + Envoy orchestration
├── envoy.yaml                         # Envoy proxy config (ext_authz + dynamic forward proxy)
├── Dockerfile                         # Gateway service container image
└── pyproject.toml                     # Root project configuration (Hatch workspaces)
```

---

## Quick Start

### Prerequisites

- **Python** ≥ 3.10
- **Node.js** ≥ 18 (for TypeScript enforcement and scoring packages)
- **Docker & Docker Compose** (for production deployment with Envoy + OPA)
- **pip** (Python package manager)

### Local Development Setup

**1. Clone the repository**

```bash
git clone https://github.com/your-org/guard-backbone.git
cd guard-backbone
```

**2. Install Python dependencies**

```bash
pip install -e .
```

This installs all workspace packages (`core`, `sdk`, `logic`, `scoring`, `enforcement`) in editable mode using Hatch workspaces. Core dependencies include FastAPI, Pydantic, Uvicorn, urllib3, and prometheus-client.

**3. Install TypeScript dependencies** (for enforcement and scoring)

```bash
cd packages/enforcement && npm install && cd ../..
cd packages/scoring && npm install && cd ../..
```

**4. Start the Gateway**

```bash
python apps/gateway/gateway_service/main.py
```

The Sovereign Core Gateway will start on `http://localhost:8090`.

**5. Verify it's running**

```bash
curl http://localhost:8090/health
```

Expected response:

```json
{
  "status": "healthy",
  "service": "Sovereign Core",
  "tagline": "The Runtime Firewall for AI Agents"
}
```

---

## Deployment

### Docker Compose (Production)

The production deployment orchestrates three services into a network-level sandbox that prevents agents from bypassing the Backbone.

**Start all services:**

```bash
docker compose up -d
```

This launches:

| Service | Container | Port | Purpose |
|---|---|---|---|
| **Gateway** | `gateway-service` | `8000` | FastAPI application running the Sovereign Safety Loop. Built from the repo's `Dockerfile` |
| **OPA** | `opa-server` | `8181` | Open Policy Agent server loaded with `/policies/*.rego` files. Evaluates all policy queries |
| **Envoy** | `envoy-proxy` | `8080` (traffic), `9901` (admin) | Intercepts all agent traffic. Calls Gateway's `/ext_authz` endpoint before forwarding any request |

All three services run on a shared `sandbox_network` bridge. The Envoy proxy is configured with `failure_mode_allow: false`, meaning if the Gateway is unreachable, **all traffic is denied** — the system fails closed.

**Environment variables:**

| Variable | Service | Description |
|---|---|---|
| `OPA_URL` | `gateway-service` | URL to query OPA for policy decisions. Default: `http://opa:8181/v1/data/system_rules/allow` |
| `STRIPE_API_KEY` | `gateway-service` | Stripe API key for real-time budget verification |
| `SPIFFE_TRUST_DOMAIN` | `gateway-service` | SPIFFE trust domain for X.509 SVID verification. Default: `example.org` |

### Envoy Configuration

The Envoy proxy (`envoy.yaml`) is configured with:

- **`ext_authz` filter**: Routes every incoming request to `http://gateway-service:8000/authorize_action` with a `0.5s` timeout. Allowed headers: `authorization`, `content-type`.
- **Dynamic forward proxy**: After authorization, forwards the request to its original destination via DNS-based dynamic routing (`V4_ONLY`).
- **Admin interface**: Available on port `9901` for debugging and stats.

### Dockerfile

The Gateway service container is built from `python:3.11-slim`, installs system dependencies (`gcc`, `curl`), copies the entire workspace, and runs `pip install -e .` to install all local packages. Uvicorn serves the FastAPI application on port `8000`.

---

## Packages

### `packages/core` — Security Kernel

The **central nervous system** of Guard Backbone. Contains the `AutonomyCore` engine that executes the Sovereign Safety Loop, the dependency injection container, runtime configuration, all abstract interfaces, and the production-grade implementations for identity, economics, and infrastructure simulation.

#### `AutonomyCore` — The Safety Loop Engine

`AutonomyCore` is the orchestrator. It receives an `ActionAuthorizationRequest`, runs it through all six checkpoints sequentially, and returns an `ActionAuthorizationResponse` with a binary decision, human-readable reason, and numeric risk score.

```python
class AutonomyCore:
    def __init__(self,
                 identity: IdentityProvider,
                 enforcement: EnforcementEngine,
                 economic: EconomicPolicyEngine,
                 scoring: ScoringEngine,
                 simulation: SimulationEngine,
                 governance: GovernanceEngine):
```

The entire `authorize_action` method is wrapped in a `try/except` that catches **all exceptions** and returns `is_authorized=False` with reason `"System Failure: Default-Deny"`. There is no code path that results in a silent approval.

#### `SpiffeIdentityProvider` — Cryptographic Agent Identity

Replaces simple string-based agent IDs with **X.509 SVID (SPIFFE Verifiable Identity Document)** verification. Agents must present a PEM-encoded X.509 certificate containing a SPIFFE URI in the Subject Alternative Name (SAN) extension.

**Verification process:**

1. Parse the PEM-encoded X.509 certificate using the `cryptography` library
2. Extract the Subject Alternative Name extension (`OID 2.5.29.17`)
3. Locate the first URI starting with `spiffe://`
4. Verify the trust domain matches the configured `SPIFFE_TRUST_DOMAIN` (e.g., `spiffe://example.org/agent/123`)
5. Return `is_valid=True` only if all checks pass

**Failure modes** — all result in `is_valid=False`:

- Certificate is not valid PEM format → `"Invalid X.509 SVID format"`
- No SAN extension present → `"Missing SAN extension in SVID"`
- No URI SAN found → `"No URI SAN found in SVID"`
- No `spiffe://` URI in SANs → `"No SPIFFE ID found in URI SAN"`
- Trust domain mismatch → `"SPIFFE ID not in trusted domain: {domain}"`

```python
provider = SpiffeIdentityProvider(trust_domain="production.mycompany.com")
result = await provider.verify(pem_encoded_svid)
# result.is_valid → True/False
# result.reason → human-readable explanation on failure
```

#### `StripeEconomicPolicyEngine` — Real Financial Controls

Replaces mock budget checks with **real-time Stripe API queries**. Each agent is mapped to a Stripe `Customer` object via `metadata['agent_id']`.

**Fund verification process:**

1. Search Stripe for a customer whose metadata contains `agent_id` matching the requesting agent
2. If no customer found → `has_funds=False`
3. Read the customer's `balance` field. In Stripe, a **negative balance** represents credit available to the customer
4. If `balance < 0` → agent has credit. Convert from cents to dollars and return `has_funds=True` with the credit amount
5. If `balance ≥ 0` → `has_funds=False`
6. Any Stripe API exception → `has_funds=False` (fail closed)

```python
engine = StripeEconomicPolicyEngine(api_key="sk_live_...")
# Or set STRIPE_API_KEY environment variable
result = await engine.has_funds(BudgetEvaluationRequest(
    agent_id="AgentZero",
    action_type="transfer_funds",
    payload={"amount": 500}
))
# result.has_funds → True/False
# result.balance → available credit in dollars
```

#### `TerraformSimulator` — Deterministic Impact Simulation

Replaces heuristic-based impact prediction with **deterministic infrastructure analysis**. When an agent proposes a resource-modifying action (e.g., `delete_database`), the simulator:

1. Locates the corresponding Terraform configuration directory at `{sandbox_dir}/{action_type}/`
2. Executes `terraform plan -out=plan.binary` against that directory
3. Runs `terraform show -json plan.binary` to parse the plan as structured JSON
4. Counts resource changes from the `resource_changes` array:
   - Resources with `"delete"` in their actions
   - Resources with `"update"` in their actions
   - Resources with `"create"` in their actions
5. Calculates a deterministic **Physical Blast Radius** score:

```
impact_score = (deletions × 100) + (changes × 50) + (creations × 10)
```

**Failure modes:**

| Condition | Impact Score | Behavior |
|---|---|---|
| Sandbox directory not found | `0.0` | Warning logged, action proceeds with zero impact |
| `terraform plan` fails (return code ≠ 0) | `100.0` | Plan failure treated as maximum risk |
| `terraform show` fails | `100.0` | Unable to parse plan treated as maximum risk |
| JSON parse error | `100.0` | Corrupted output treated as maximum risk |

#### Abstract Interfaces

Every security module is defined by an abstract interface. Swap any implementation without changing the core:

```python
class IdentityProvider(ABC):
    async def verify(self, agent_id: str) -> VerificationResult: ...
    async def register(self, request: AgentRegistrationRequest) -> AgentRegistrationResponse: ...

class EnforcementEngine(ABC):
    async def validate(self, request: ActionAuthorizationRequest) -> ActionAuthorizationResponse: ...

class EconomicPolicyEngine(ABC):
    async def has_funds(self, request: BudgetEvaluationRequest) -> BudgetEvaluationResponse: ...

class SimulationEngine(ABC):
    async def predict_impact(self, request: SimulationRequest) -> SimulationResponse: ...

class ScoringEngine(ABC):
    async def calculate_score(self, action: ActionAuthorizationRequest, impact_score: float) -> ScoringResult: ...

class GovernanceEngine(ABC):
    async def record_action(self, record: GovernanceRecord) -> GovernanceResult: ...
    async def submit_proposal(self, request: GovernanceProposalRequest) -> GovernanceProposalResponse: ...
```

#### State Backends

Pluggable state persistence through the `StateStore` interface:

| Backend | Status | Description |
|---|---|---|
| `memory` | ✅ Implemented | In-memory dictionary store (default, for development) |
| `file` | ✅ Implemented | JSON file-based persistence |
| `sqlite` | 🔲 Planned | SQLite-backed state storage |
| `redis` | 🔲 Planned | Redis-backed distributed state |

---

### `packages/sdk` — Python SDK

The **developer-facing entry point** for integrating Guard Backbone into any Python application. Wraps the `AutonomyCore` behind a clean, high-level API with both async and synchronous interfaces.

#### `AutonomyClient`

```python
from guard.sdk.client import AutonomyClient

# Option A: Local in-memory engine (no server required)
client = AutonomyClient()

# Option B: Remote gateway connection
client = AutonomyClient(server_url="http://localhost:8090")
```

#### Core Methods

| Method | Async | Description |
|---|---|---|
| `authorize()` | `async` | Returns `True`/`False` — is the action authorized? |
| `authorize_action()` | `async` | Returns full details including `risk_score` and `decision` |
| `register_agent()` | `async` | Registers a new agent with identity attributes |
| `propose_change()` | `async` | Submits a governance/configuration change proposal |
| `get_system_status()` | sync | Returns health status of all security modules |

Every async method has a synchronous wrapper (e.g., `authorize_sync()`, `register_agent_sync()`).

#### Circuit Breaker Middleware

The SDK includes a **circuit breaker** decorator that uses the unified `risk_score` from the Sovereign Safety Loop to make its kill-switch decision. If the score exceeds the threshold, a `SecurityViolation` exception is raised **before** the decorated function body executes.

```python
from guard.sdk.client import AutonomyClient
from guard.sdk.middleware import circuit_breaker

client = AutonomyClient()

@circuit_breaker(client, agent_id="AgentZero", action_type="transfer_funds", threshold=85.0)
async def transfer_money(amount: float, recipient: str):
    # This function body will NEVER execute if risk_score > 85.0
    await bank_api.transfer(amount, recipient)
```

The circuit breaker is deterministic — for the same agent, action type, and system state, it will always produce the same allow/deny decision.

---

### `packages/logic` — Policy Logic Layer (Python)

A comprehensive policy management system that handles the full lifecycle from natural language policy definition to real-time enforcement. The enforcement module has been refactored to function as a **Protocol Gateway** that delegates all policy evaluation to the external OPA engine.

#### PolicyEnforcer — OPA Protocol Gateway

The `PolicyEnforcer` no longer contains internal condition evaluation or exception matching logic. It is a thin gateway that:

1. Extracts `agent_id` and `action_type` from the context
2. Passes them along with the full state payload to `OpaClient.query_policy()`
3. Returns an `EnforcementResult` based on OPA's boolean response

```python
from guard.logic.enforcement.engine import PolicyEnforcer, OpaClient

# Uses default OPA endpoint: http://localhost:8181/v1/data/system/rules/allow
enforcer = PolicyEnforcer()

# Or with a custom OPA endpoint
enforcer = PolicyEnforcer(
    opa_client=OpaClient(
        endpoint_url="http://opa:8181/v1/data/system/rules/allow",
        timeout_seconds=2.0
    )
)

result = enforcer.evaluate(
    state={"requested_budget": 500, "agent_level": 3},
    context={"agent_id": "AgentZero", "action_type": "transfer_funds"}
)
# result.is_allowed → True/False
# result.policy_id → "opa_system_policy"
```

#### OpaClient — Failsafe Policy Query

The `OpaClient` constructs a JSON payload from the agent ID, action type, and state, sends it to the OPA server's REST API, and parses the boolean response. It implements **fail-closed** behavior:

- **OPA server unreachable** → `False` (DENY)
- **Request timeout** (default 2 seconds) → `False` (DENY)
- **Non-200 HTTP response** → `False` (DENY)
- **JSON parse error** → `False` (DENY)

The client merges payload properties into the top-level input object so that Rego rules can reference fields like `input.agent_level` and `input.requested_budget` directly.

#### OPA Rego Policies

Policies are defined in Rego and loaded into the OPA server from the `/policies` directory. The default policy (`system_rules.rego`) implements:

```rego
package system.rules

max_allowed := 1000

# Default-deny — all actions are blocked unless explicitly allowed
default allow := false

# Allow only if agent has a positive clearance level AND requested budget is under limit
allow {
    input.agent_level > 0
    input.requested_budget < max_allowed
}
```

To add new policies, create additional `.rego` files in the `policies/` directory. They are automatically loaded by the OPA server container.

#### TamperEvidentLedger — Immutable Audit Trail

Every authorization decision is recorded in a SQLite-backed ledger where each record includes the SHA-256 hash of the preceding record's data. This creates a blockchain-like chain where:

- **Modifying** any historical record changes its hash, which breaks the chain for all subsequent records
- **Deleting** a record creates a gap that `verify_chain()` detects immediately
- **Inserting** a record between existing entries is impossible without recalculating the entire chain

```python
from guard.logic.repository import TamperEvidentLedger

ledger = TamperEvidentLedger(db_url="sqlite:///audit.db")

# Record a decision
record_hash = ledger.record_decision({
    "agent_id": "AgentZero",
    "action_type": "transfer_funds",
    "decision": "APPROVED",
    "risk_score": 23.5,
    "metadata": {"reason": "All checks passed"}
})

# Verify the entire chain hasn't been tampered with
is_intact = ledger.verify_chain()  # True if chain is unbroken
```

**Hash calculation**: Each record's hash is computed as `SHA-256(JSON(decision + previous_hash + timestamp))` with `sort_keys=True` for deterministic serialization. The previous hash is also embedded inside the decision's `metadata` dictionary, creating a double-link that makes retroactive modification even harder to conceal.

#### Additional Sub-modules

| Module | Description |
|---|---|
| **`translator/`** | `PolicySchemaTranslator` — translates natural language text into machine-readable `StructuredPolicy` objects |
| **`repository/`** | `PolicyRepository` — SQLite-backed CRUD for policies with version support and template cloning |
| **`universal_policy_parser/`** | `UniversalPolicyParser` — parses heterogeneous policy formats (free text, lists, dicts) into a unified logical model |
| **`live_update/`** | `LiveUpdateEngine` — monitors policy sources and propagates hot updates to running workflows with zero downtime |
| **`version_control/`** | `VersionControlEngine` — manages policy deployments (staging → testing → production), rollbacks, and adoption tracking |
| **`extensibility/`** | Template modules and validation utilities for extending the policy system |
| **`feedback/`** | Feedback connector for continuous policy improvement |

#### StructuredPolicy Schema

Every policy in the system conforms to the `StructuredPolicy` model:

```python
class StructuredPolicy(BaseModel):
    policy_id: str              # Unique identifier
    title: str                  # Human-readable title
    version: str                # Semantic version (e.g., "1.0.0")
    domain: PolicyDomain        # governance | finance | operations | ethics | security | legal
    scope: PolicyScope          # global | domain_specific | team | agent_specific
    industry: Optional[str]     # e.g., "healthcare", "finance"
    compliance_type: Optional[str]  # e.g., "GDPR", "SOC2"

    conditions: List[LogicalCondition]   # When does this policy activate?
    triggers: List[ActionTrigger]        # What actions to take on activation/violation?
    exceptions: List[ExceptionHandler]   # When is the policy bypassed?
    instructions: List[str]              # Step-by-step instructions for agents

    raw_source: str             # Original natural language text
    rationale: str              # Why was this policy translated this way?
```

#### Condition Operators

| Operator | Symbol | Example |
|---|---|---|
| Greater Than | `>` | `budget > 1000` |
| Less Than | `<` | `risk_score < 0.5` |
| Greater or Equal | `>=` | `clearance >= 3` |
| Less or Equal | `<=` | `attempts <= 5` |
| Equal | `==` | `status == "active"` |
| Not Equal | `!=` | `role != "admin"` |
| Contains | `contains` | `tags contains "sensitive"` |
| Regex Match | `matches` | `name matches "^agent_[0-9]+"` |

---

### `packages/enforcement` — Enforcement Engine (TypeScript)

A **multi-layered enforcement system** that provides guardrails at every stage of action execution. Actions move through a deterministic state machine across five enforcement layers.

#### Enforcement Layers

```
Action Proposed
      │
      ▼
┌─────────────────────┐
│  Pre-Execution       │ ◄── Predictive risk analysis, permission validation
│  Layer               │     Blocks high-risk actions before execution begins
├─────────────────────┤
│  In-Process          │ ◄── Runtime anomaly detection, behavior monitoring
│  Layer               │     Suspends actions mid-execution if anomalies detected
├─────────────────────┤
│  Post-Execution      │ ◄── Compliance audit, outcome validation
│  Layer               │     Flags violations after execution completes
├─────────────────────┤
│  Adaptive            │ ◄── Dynamic intervention based on violation severity
│  Intervention Layer  │     Responds to real-time violation events
├─────────────────────┤
│  Remediation         │ ◄── Rollback transactions, stakeholder notification,
│  Engine              │     trust recalibration
└─────────────────────┘
```

#### Enforcement State Machine

```
PENDING → PRE_EXECUTION_PASSED → EXECUTING → COMPLETED
                                           → SUSPENDED
         PRE_EXECUTION_FAILED (terminal)
```

#### Key Features

- **Predictive Risk Engine**: Uses heuristics to predict behavior vectors and estimate risk before execution
- **Anomaly Detection**: In-process monitoring for drift from expected behavior
- **Decision Explanation Logging**: Every enforcement decision includes a structured explanation with rationale and evidence
- **Violation Propagation**: Cross-layer violation awareness through an internal event bus
- **Threshold Adaptation**: Dynamic threshold tuning based on historical outcomes
- **Remediation Engine**: Automated rollback with full transaction traces and stakeholder notifications

---

### `packages/scoring` — Risk Scoring Engine (TypeScript)

A **context-aware, multi-dimensional risk scoring system** that evaluates every action across nine distinct risk dimensions.

#### Risk Dimensions

| Dimension | Description |
|---|---|
| `operationalRisk` | Risk to system operations and availability |
| `regulatoryExposure` | Exposure to regulatory compliance violations |
| `financialCost` | Direct and indirect financial impact |
| `reputationalImpact` | Potential damage to organizational reputation |
| `cooperativeSystemStability` | Impact on multi-agent system stability |
| `predictedComplianceProbability` | Likelihood of remaining compliant over time |
| `simulationImpact` | Forward-simulated downstream effects |
| `opportunityCostProjection` | Cost of alternative actions not taken |
| `strategicMisalignment` | Deviation from organizational strategic goals |

#### Adaptive Calibration

The scoring engine supports **online recalibration** through feedback loops that adjust weights based on observed real-world outcomes:

```typescript
const engine = new RiskScoringEngine();

// Score a decision
const result = engine.scoreDecision(decision, context, systemState);
// result.decisionScore → composite risk score (0.0 - 1.0)
// result.riskPressure  → system-level pressure indicator
// result.breakdown     → per-dimension breakdown with weights

// After observing real-world outcomes, recalibrate
engine.updateCalibrationFromFeedback(predicted, {
    complianceObserved: 0.8,
    stabilityIncidentOccurred: false,
    costOverrunRatio: 0.1
});
```

#### Additional Scoring Components

| Component | Purpose |
|---|---|
| `DecisionEvaluationFramework` | Transforms raw agent actions into structured `DecisionObject`s for scoring |
| `ImpactSimulationModule` | Runs forward simulations estimating task impact, synergy density, trust propagation, and intelligence evolution |
| `ComplianceEstimator` | Forecasts compliance lifecycle for proposed actions |
| `ResourceAnalyzer` | Analyzes resource consumption patterns |
| `StrategicAlignmentModule` | Evaluates strategic alignment of proposed actions |
| `PreemptiveDetectionLayer` | Early-warning system for emerging risks |
| `HumanOverrideInterface` | Human-in-the-loop approval workflows |
| `ThresholdOptimizationEngine` | Dynamically adjusts risk thresholds based on historical data |
| `HistoricalFeedbackIntegrator` | Integrates past outcomes to improve future predictions |
| `PrometheusExporter` | Exports risk metrics to Prometheus for monitoring and alerting |

---

## API Reference

### Gateway Endpoints

The Sovereign Core Gateway exposes a REST API. In local development it runs on port `8090`; in Docker it runs on port `8000` behind the Envoy proxy on port `8080`.

#### `POST /register_agent`

Register a new agent in the system. For SPIFFE-based identity, the agent must present a valid X.509 SVID during subsequent `authorize_action` calls.

**Request Body:**
```json
{
  "agent_id": "AgentZero",
  "name": "System Administrator Bot",
  "attributes": {
    "clearance": "level_5",
    "department": "engineering"
  }
}
```

**Response:**
```json
{
  "status": "success",
  "agent_id": "AgentZero"
}
```

---

#### `POST /authorize_action`

Run the full Sovereign Safety Loop on a proposed action. Returns a structured response with authorization decision, human-readable reason, and numeric risk score.

**Request Body:**
```json
{
  "agent_id": "AgentZero",
  "action_id": "tx_10294",
  "action_type": "transfer_funds",
  "payload": {
    "amount": 500,
    "currency": "USD",
    "recipient": "vendor_account_42",
    "agent_level": 3,
    "requested_budget": 500
  }
}
```

**Response (Approved):**
```json
{
  "is_authorized": true,
  "reason": "Sovereign Check Pass",
  "risk_score": 23.5
}
```

**Response (Denied — Risk):**
```json
{
  "is_authorized": false,
  "reason": "Risk Score ( 91.3 ) exceeds safety threshold",
  "risk_score": 91.3
}
```

**Response (Denied — Identity):**
```json
{
  "is_authorized": false,
  "reason": "Identity Violation"
}
```

**Response (Denied — Policy):**
```json
{
  "is_authorized": false,
  "reason": "Policy Violation: OPA denied the action"
}
```

**Response (Denied — Budget):**
```json
{
  "is_authorized": false,
  "reason": "Budget Depleted"
}
```

**Response (System Failure):**
```json
{
  "is_authorized": false,
  "reason": "System Failure: Default-Deny"
}
```

---

#### `POST /ext_authz` or `ANY /ext_authz/{path}`

The Envoy `ext_authz` endpoint. Not intended to be called directly — Envoy routes all intercepted traffic here automatically.

**Headers parsed:**

| Header | Purpose | Default |
|---|---|---|
| `x-agent-id` | Identifies the requesting agent | `"unknown-agent"` |
| `x-target-url` | The original destination URL | Reconstructed from `host` + path |
| `x-payload` | JSON-encoded payload for evaluation | `{}` |
| `x-request-id` | Unique request correlation ID | Auto-generated UUID |

**Responses:**

- `200` — Request authorized. Envoy forwards to destination
- `403` — Request denied. Envoy blocks the request. Also returned on any internal exception (fail-closed)

---

#### `POST /propose_change`

Submit a governance or configuration change proposal.

**Request Body:**
```json
{
  "proposer_id": "AgentZero",
  "changes": {
    "max_budget": 5000,
    "require_human_approval_above": 2500
  }
}
```

**Response:**
```json
{
  "status": "success"
}
```

---

#### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "Sovereign Core",
  "tagline": "The Runtime Firewall for AI Agents"
}
```

---

## SDK Usage

### Full Integration Example

```python
import asyncio
from guard.sdk.client import AutonomyClient
from guard.sdk.middleware import circuit_breaker
from guard.sdk.exceptions import SecurityViolation

async def main():
    # 1. Initialize the client
    client = AutonomyClient(config={
        "risk_thresholds": {
            "minimum_action_score": 0.0,
            "maximum_impact_score": 1.0
        },
        "budget_limits": {
            "global": 1_000_000.0,
            "per_action": 100_000.0
        }
    })

    # 2. Register an agent
    agent_id = await client.register_agent(
        agent_id="DataProcessor_01",
        name="Data Processing Agent",
        attributes={"role": "data_analyst", "clearance": "level_3"}
    )
    print(f"Registered agent: {agent_id}")

    # 3. Check authorization (simple boolean)
    is_allowed = await client.authorize(
        agent_id="DataProcessor_01",
        action_id="query_001",
        action_type="read_database",
        payload={"table": "user_metrics", "limit": 100}
    )
    print(f"Authorized: {is_allowed}")

    # 4. Get detailed authorization with risk score
    result = await client.authorize_action(
        agent_id="DataProcessor_01",
        action_id="export_001",
        action_type="export_data",
        payload={"format": "csv", "destination": "s3://reports/"}
    )
    print(f"Decision: {result['decision']}, Risk: {result['risk_score']}")

    # 5. Use circuit breaker middleware
    @circuit_breaker(client, agent_id="DataProcessor_01", action_type="delete_records", threshold=50.0)
    async def delete_old_records(days: int):
        """This function is protected — it won't execute if risk_score > 50.0"""
        print(f"Deleting records older than {days} days...")

    try:
        await delete_old_records(90)
    except SecurityViolation as e:
        print(f"Blocked: {e}")

    # 6. Check system status
    status = client.get_system_status()
    print(f"System: {status}")

asyncio.run(main())
```

### Synchronous Usage

For non-async codebases, every method has a `_sync` variant:

```python
from guard.sdk.client import AutonomyClient

client = AutonomyClient()

client.register_agent_sync("Agent_A", name="Simple Agent")
is_ok = client.authorize_sync("Agent_A", "act_1", "read_file", {"path": "/data.txt"})
client.propose_change_sync("Agent_A", {"settings.debug": True})
```

---

## Configuration

### `AutonomyConfig`

The runtime behavior of the entire system is controlled by `AutonomyConfig`, a frozen dataclass:

```python
from guard.core.config import AutonomyConfig

config = AutonomyConfig(
    # Risk thresholds for the decision gate
    risk_thresholds={
        "minimum_action_score": 0.0,
        "maximum_impact_score": 1.0,
    },

    # Budget limits
    budget_limits={
        "global": 1_000_000.0,
        "per_action": 100_000.0,
    },

    # Governance rules
    governance_rules={
        "require_proposal_review": True,
        "audit_retention_days": 90,
    },

    # Enable/disable individual security modules
    enabled_modules={
        "identity": True,
        "enforcement": True,
        "economic": True,
        "scoring": True,
        "simulation": True,
        "governance": True,
    },

    # State persistence backend
    state_backend="memory",  # "memory" | "file" | "sqlite" | "redis"

    # Module implementation overrides
    implementations={
        "identity": "default",
        "enforcement": "default",
        "economic": "default",
        "scoring": "default",
        "simulation": "default",
        "governance": "default",
    },

    # Per-module configuration
    module_options={
        "state_backend": {"path": "./state_data"},
    },
)
```

### Extending with Custom Implementations

You can replace any module with your own implementation using the DI container:

```python
from guard.core.container import AutonomyContainer
from guard.core.interfaces import IdentityProvider
from guard.core.schemas.models import VerificationResult, AgentRegistrationRequest, AgentRegistrationResponse

class MyCustomIdentity(IdentityProvider):
    async def verify(self, agent_id: str) -> VerificationResult:
        is_valid = await my_auth_service.check(agent_id)
        return VerificationResult(is_valid=is_valid)

    async def register(self, request: AgentRegistrationRequest) -> AgentRegistrationResponse:
        await my_auth_service.register(request.agent_id, request.attributes)
        return AgentRegistrationResponse(agent_id=request.agent_id, success=True)

# Register your custom factory
container = AutonomyContainer()
container.register_factory(
    "identity",
    "custom",
    lambda cfg, ctr: MyCustomIdentity()
)
```

---

## Security Model

### Design Principles

| Principle | Implementation |
|---|---|
| **Default-Deny** | Any system failure automatically blocks the action. A `try/except` around the entire safety loop catches all errors and returns `is_authorized=False`. OPA client defaults to DENY on timeout. Envoy is configured with `failure_mode_allow: false`. Stripe API errors return `has_funds=False` |
| **Defense in Depth** | Six sequential in-loop checkpoints (identity → policy → budget → simulation → scoring → decision), plus a multi-layer enforcement engine (pre-execution, in-process, post-execution, intervention, remediation), plus network-level interception via Envoy proxy |
| **Cryptographic Identity** | Agents authenticate using X.509 SVIDs issued by SPIRE. Certificate parsing, SAN extraction, and trust domain verification prevent identity spoofing and shadow agents |
| **Externalized Policy** | All policy evaluation runs on an external OPA server. Policies are defined in Rego, version-controlled separately from application code, and auditable by compliance teams without touching Python |
| **Real Financial Controls** | Budget checks hit the Stripe API. Agent spend is tracked through real payment infrastructure, not in-memory counters that reset on restart |
| **Deterministic Decisions** | The safety loop produces repeatable results given the same inputs. OPA evaluation is deterministic. Terraform plan output is deterministic. No hidden randomness in authorization logic |
| **Immutable Audit Trail** | SHA-256 hash-chained ledger where each record's integrity depends on all preceding records. Tampering with any record invalidates the chain from that point forward |
| **Network-Level Enforcement** | Envoy proxy intercepts all agent network traffic. Even if an agent's application code is compromised, it cannot make network requests without Backbone approval |
| **500ms SLA** | The Envoy `ext_authz` timeout is set to 500ms. Actions that exceed this are denied (fail-closed) |
| **Zero-Downtime Updates** | The `LiveUpdateEngine` allows policies to be changed in running systems without restarts |

### Exception Hierarchy

```
AutonomyException (base)
├── IdentityError
├── EnforcementError
├── BudgetViolationError
├── GovernanceRejectionError
└── SimulationFailure

AutonomySDKError (SDK base)
├── AgentRegistrationError
├── ActionAuthorizationError
├── ClientConnectionError
├── ProposalError
└── SecurityViolation          ← raised by circuit breaker
    └── CircuitBreakerException
```

---

## Data Models

### Request/Response Schemas

All data flowing through the system is validated with **Pydantic models**:

| Model | Fields | Purpose |
|---|---|---|
| `ActionAuthorizationRequest` | `agent_id`, `action_id`, `action_type`, `payload` | Input to the safety loop |
| `ActionAuthorizationResponse` | `is_authorized`, `reason`, `risk_score` | Output from the safety loop |
| `AgentRegistrationRequest` | `agent_id`, `name`, `attributes` | Agent registration input |
| `AgentRegistrationResponse` | `agent_id`, `success`, `message` | Registration result |
| `VerificationResult` | `is_valid`, `reason` | Identity check result |
| `BudgetEvaluationRequest` | `agent_id`, `action_type`, `payload` | Budget check input |
| `BudgetEvaluationResponse` | `has_funds`, `balance` | Budget check result |
| `SimulationRequest` | `agent_id`, `action_type`, `payload` | Simulation input |
| `SimulationResponse` | `impact_score`, `details` | Simulation result |
| `ScoringResult` | `action_score`, `threshold_met` | Risk scoring output |
| `GovernanceProposalRequest` | `proposer_id`, `changes` | Configuration change proposal |
| `GovernanceRecord` | `agent_id`, `action`, `action_score`, `timestamp` | Audit record |

### Gateway-Specific Models

| Type | Values |
|---|---|
| `GatewayDecision` | `APPROVED`, `SOFT_BLOCK`, `HUMAN_REQUIRED`, `DENIED`, `QUEUED`, `BLOCKED` |
| `ApprovalStatus` | `PENDING_APPROVAL`, `APPROVED`, `REJECTED` |
| `AdminVerdict` | `APPROVE`, `REJECT` |

---

## Logging

Guard Backbone uses **structured JSON logging** throughout. Every log entry includes contextual fields for correlation:

```json
{
  "timestamp": "2026-03-07T17:30:00.000Z",
  "level": "INFO",
  "module": "AutonomyCore",
  "message": "Registering agent: AgentZero",
  "agent_id": "AgentZero",
  "action_id": "tx_10294",
  "decision_outcome": "APPROVED",
  "risk_score": 23.5
}
```

Structured logs are designed for ingestion by observability platforms (ELK Stack, Datadog, Splunk, etc.).

---

## Observability

### Prometheus Metrics

The scoring package includes a `PrometheusExporter` that exposes risk metrics for monitoring:

- **Gauges**: Current risk scores, threshold values, active agent count
- **Histograms**: Decision latency, risk score distribution
- **Counters**: Total actions evaluated, violations detected, actions blocked

These metrics can be scraped by Prometheus and visualized in Grafana dashboards.

---

## Testing

### Running Tests

**Gateway tests:**

```bash
cd apps/gateway
pytest tests/ -v
```

**Logic package tests:**

```bash
cd packages/logic
pytest tests/ -v
```

### Test Coverage

| Test File | Coverage |
|---|---|
| `test_policy_enforcement.py` | Policy evaluation, OPA delegation, condition operators, exception handling |
| `test_translation.py` | NL-to-structured policy translation |
| `test_repository.py` | Policy CRUD, versioning, template cloning |
| `test_universal_policy_parser.py` | Multi-format parsing (text, list, dict) |
| `test_live_update_engine.py` | Hot-reload, fingerprinting, workflow broadcasting |
| `test_version_control.py` | Deployment lifecycle, rollback, adoption tracking |
| `test_adaptive_guardrails.py` | Dynamic guardrail behavior |
| `test_cross_domain_mapper.py` | Cross-domain policy mapping |
| `test_feedback_connector.py` | Feedback loop testing |
| `test_policy_conflict_detector.py` | Policy conflict detection |
| `test_template_extensibility.py` | Template module validation |

### Gateway Test Examples

```python
# Verify full safety loop approval
def test_action_approved():
    response = client.post("/action", json={...})
    assert response.json()["decision"] == "APPROVED"

# Verify identity failure results in denial
def test_action_denied_when_identity_invalid():
    response = client.post("/action", json={...})
    assert response.json()["decision"] == "DENIED"

# Verify 500ms SLA timeout — low-risk actions get SOFT_BLOCK
def test_safety_timeout_soft_block_for_low_risk_action():
    response = client.post("/action", json={...})
    assert response.json()["decision"] == "SOFT_BLOCK"

# Verify 500ms SLA timeout — high-risk actions require human review
def test_safety_timeout_human_required_for_high_risk_action():
    response = client.post("/action", json={...})
    assert response.json()["decision"] == "HUMAN_REQUIRED"
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Core Engine** | Python 3.10+, Pydantic |
| **Gateway API** | FastAPI, Uvicorn |
| **Identity** | SPIFFE/SPIRE, `cryptography` (X.509 SVID parsing) |
| **Policy Engine** | Open Policy Agent (OPA), Rego |
| **Economic Controls** | Stripe Python SDK |
| **Infrastructure Simulation** | `python-terraform` (Terraform CLI wrapper) |
| **SDK** | Python, urllib3 |
| **Enforcement Engine** | TypeScript, Node.js |
| **Risk Scoring** | TypeScript, Node.js |
| **Policy Storage** | SQLAlchemy, SQLite |
| **Audit Ledger** | SQLite, SHA-256 hash chains |
| **Network Proxy** | Envoy Proxy (`ext_authz` filter) |
| **Container Orchestration** | Docker Compose |
| **Observability** | Prometheus Client |
| **Build System** | Hatch (Python), npm (TypeScript) |
| **Testing** | pytest, httpx |

---

## Roadmap

- [ ] Redis and SQLite state backend implementations
- [ ] gRPC transport layer for low-latency inter-service communication
- [ ] Web dashboard for real-time risk visualization
- [ ] Multi-tenancy support with isolated policy namespaces
- [ ] LLM-powered policy translation (currently heuristic-based)
- [ ] Kubernetes Helm chart for production deployment
- [ ] OpenTelemetry tracing across the full safety loop
- [ ] A2A (Agent-to-Agent) protocol compatibility
- [ ] SPIRE server integration for automated SVID rotation
- [ ] Stripe webhook listener for real-time balance change notifications
- [ ] Terraform Cloud integration for remote plan execution

---

## Contributing

Contributions are welcome. Please follow these guidelines:

1. **Fork** the repository and create a feature branch
2. **Write tests** for any new functionality
3. **Follow the interface pattern** — if adding a new security module, implement the corresponding abstract interface from `packages/core/guard/core/interfaces.py`
4. **Externalize policy logic** — enforcement rules belong in Rego files under `policies/`, not in Python code
5. **Fail closed** — any new integration must default to DENY on error, timeout, or unexpected state
6. **Document** any new configuration options, API endpoints, or environment variables
7. Submit a **pull request** with a clear description of the change

---

## License

This project is under active development. License details will be added upon initial public release.

---

<p align="center">
  <strong>Guard Backbone</strong> — Because autonomous agents should have boundaries.
</p>

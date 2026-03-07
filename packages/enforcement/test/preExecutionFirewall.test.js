"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PreExecutionFirewall, ActionExecutor } = require("../enforcement_layer");

function buildFirewall() {
  return new PreExecutionFirewall({
    allowedIntents: new Set(["send_notification", "read_state"]),
    authorityGraph: new Map([
      ["agent.core", new Set(["notify.user", "state.read"])],
      ["agent.readonly", new Set(["state.read"])],
    ]),
    policyByActionType: new Map([
      [
        "notify.user",
        (action) => ({
          pass: typeof action.payload?.message === "string" && action.payload.message.length > 0,
          reason: "Notification message is required",
        }),
      ],
      ["state.read", () => ({ pass: true })],
    ]),
    thresholds: {
      maxRiskScore: 0.7,
      minStabilityScore: 0.35,
    },
    rerouteStrategy: (action) => {
      if ((action.predicted?.riskScore ?? 0) > 0.7) {
        return "safety_review";
      }
      return null;
    },
  });
}

test("allows compliant action and executes it", () => {
  const firewall = buildFirewall();
  let executed = false;
  const executor = new ActionExecutor(firewall, {
    execute: () => {
      executed = true;
      return "ok";
    },
  });

  const output = executor.execute({
    type: "notify.user",
    payload: { message: "hello" },
    declared: { intent: "send_notification", authorityId: "agent.core" },
    predicted: { riskScore: 0.2, stabilityScore: 0.9 },
  });

  assert.equal(output, "ok");
  assert.equal(executed, true);
});

test("blocks action with invalid intent and missing policy data", () => {
  const firewall = buildFirewall();
  const evaluation = firewall.evaluate({
    type: "notify.user",
    payload: { message: "" },
    declared: { intent: "delete_everything", authorityId: "agent.core" },
    predicted: { riskScore: 0.2, stabilityScore: 0.9 },
  });

  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.rerouteTarget, null);
  assert.equal(evaluation.reasons.length > 0, true);
  assert.match(evaluation.reasons.join(" | "), /intent/i);
  assert.match(evaluation.reasons.join(" | "), /message/i);
});

test("reroutes action when predicted risk exceeds threshold", () => {
  const firewall = buildFirewall();
  let rerouted = "";
  const executor = new ActionExecutor(firewall, {
    execute: () => "should not run",
    reroute: (_action, target) => {
      rerouted = target;
      return "queued";
    },
  });

  const output = executor.execute({
    type: "notify.user",
    payload: { message: "needs review" },
    declared: { intent: "send_notification", authorityId: "agent.core" },
    predicted: { riskScore: 0.95, stabilityScore: 0.8 },
  });

  assert.equal(output, "queued");
  assert.equal(rerouted, "safety_review");
});

test("blocks when stability falls below threshold", () => {
  const firewall = buildFirewall();
  const evaluation = firewall.evaluate({
    type: "state.read",
    payload: {},
    declared: { intent: "read_state", authorityId: "agent.readonly" },
    predicted: { riskScore: 0.1, stabilityScore: 0.2 },
  });

  assert.equal(evaluation.decision, "block");
  assert.match(evaluation.reasons.join(" | "), /stability/i);
});

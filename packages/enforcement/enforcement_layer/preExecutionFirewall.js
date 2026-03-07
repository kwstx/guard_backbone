"use strict";

/**
 * @typedef {"allow" | "block" | "reroute"} FirewallDecisionType
 */

/**
 * @typedef {Object} ActionProposal
 * @property {string} type
 * @property {Object<string, unknown>} payload
 * @property {{ intent?: string, authorityId?: string }} declared
 * @property {{ riskScore?: number, stabilityScore?: number }} predicted
 * @property {Object<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} FirewallThresholds
 * @property {number} maxRiskScore
 * @property {number} minStabilityScore
 */

/**
 * @typedef {Object} FirewallConfig
 * @property {Set<string>} allowedIntents
 * @property {Map<string, Set<string>>} authorityGraph
 * @property {Map<string, (action: ActionProposal) => { pass: boolean, reason?: string }>} policyByActionType
 * @property {FirewallThresholds} thresholds
 * @property {(action: ActionProposal) => string | null} [rerouteStrategy]
 */

class PreExecutionFirewall {
  /**
   * @param {FirewallConfig} config
   */
  constructor(config) {
    this.allowedIntents = config.allowedIntents || new Set();
    this.authorityGraph = config.authorityGraph || new Map();
    this.policyByActionType = config.policyByActionType || new Map();
    this.thresholds = config.thresholds || { maxRiskScore: 1, minStabilityScore: 0 };
    this.rerouteStrategy =
      config.rerouteStrategy ||
      ((action) => {
        if ((action.predicted?.riskScore ?? 0) > this.thresholds.maxRiskScore) {
          return "human_review_queue";
        }
        return null;
      });
  }

  /**
   * @param {ActionProposal} action
   * @returns {{ decision: FirewallDecisionType, reasons: string[], rerouteTarget: string | null }}
   */
  evaluate(action) {
    const reasons = [];

    if (!action || typeof action !== "object") {
      return { decision: "block", reasons: ["Malformed action proposal"], rerouteTarget: null };
    }

    const intent = action.declared?.intent;
    if (!intent || !this.allowedIntents.has(intent)) {
      reasons.push("Declared intent is missing or unauthorized");
    }

    const authorityId = action.declared?.authorityId;
    if (!authorityId) {
      reasons.push("Authority declaration is missing");
    } else {
      const allowedActions = this.authorityGraph.get(authorityId);
      if (!allowedActions || !allowedActions.has(action.type)) {
        reasons.push("Action type is not permitted by authority graph");
      }
    }

    const policyCheck = this.policyByActionType.get(action.type);
    if (policyCheck) {
      const result = policyCheck(action);
      if (!result.pass) {
        reasons.push(result.reason || "Policy compliance failed");
      }
    } else {
      reasons.push("No policy registered for action type");
    }

    const riskScore = action.predicted?.riskScore ?? 0;
    const stabilityScore = action.predicted?.stabilityScore ?? 1;

    if (riskScore > this.thresholds.maxRiskScore) {
      reasons.push(
        `Predicted impact risk ${riskScore.toFixed(2)} exceeds threshold ${this.thresholds.maxRiskScore.toFixed(2)}`
      );
    }

    if (stabilityScore < this.thresholds.minStabilityScore) {
      reasons.push(
        `Cooperative stability ${stabilityScore.toFixed(2)} below threshold ${this.thresholds.minStabilityScore.toFixed(2)}`
      );
    }

    if (reasons.length === 0) {
      return { decision: "allow", reasons: [], rerouteTarget: null };
    }

    const rerouteTarget = this.rerouteStrategy(action);
    if (rerouteTarget) {
      return { decision: "reroute", reasons, rerouteTarget };
    }

    return { decision: "block", reasons, rerouteTarget: null };
  }
}

module.exports = { PreExecutionFirewall };

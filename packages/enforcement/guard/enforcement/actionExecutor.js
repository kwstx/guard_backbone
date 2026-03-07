"use strict";

class ActionExecutor {
  /**
   * @param {{ evaluate: (action: any) => { decision: "allow" | "block" | "reroute", reasons: string[], rerouteTarget: string | null } }} firewall
   * @param {{ execute: (action: any) => any, reroute?: (action: any, target: string) => any }} handlers
   */
  constructor(firewall, handlers) {
    this.firewall = firewall;
    this.handlers = handlers;
  }

  /**
   * @param {any} action
   * @returns {any}
   */
  execute(action) {
    const result = this.firewall.evaluate(action);

    if (result.decision === "allow") {
      return this.handlers.execute(action);
    }

    if (result.decision === "reroute") {
      if (typeof this.handlers.reroute !== "function") {
        throw new Error(
          `Action rerouted to ${result.rerouteTarget}, but no reroute handler is configured. Reasons: ${result.reasons.join(
            "; "
          )}`
        );
      }
      return this.handlers.reroute(action, result.rerouteTarget);
    }

    throw new Error(`Action blocked by PreExecutionFirewall: ${result.reasons.join("; ")}`);
  }
}

module.exports = { ActionExecutor };

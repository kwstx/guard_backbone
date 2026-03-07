# Scorring Module Prometheus Exporter

The scoring pipeline now exports live Prometheus metrics whenever `RiskScoringEngine.scoreDecision()` runs.

## Metrics

- `scorring_risk_pressure` (`0.0` to `1.0`)
- `scorring_anomaly_sensitivity` (`0.5` to `2.0`)
- `scorring_decision_score` (`0` to `100`)
- `scorring_metric_updates_total` (counter)

## Endpoint

- Default: `http://localhost:9464/metrics`

## Configuration

- `SCORRING_METRICS_ENABLED` (default `true`)
- `SCORRING_METRICS_PORT` (default `9464`)
- `SCORRING_METRICS_PATH` (default `/metrics`)

## Wiring with Threshold Adaptation

Pass `ThresholdAdaptationEngine` profile values into `riskContext`:

```ts
const profile = thresholdAdaptationEngine.getCurrentProfile();
const score = scoringEngine.scoreDecision(
  decisionObject,
  {
    ...riskContext,
    anomalySensitivity: profile.anomalySensitivity,
  },
  systemState
);
```

This allows Grafana panels to visualize "brake pressure" (`scorring_risk_pressure`) next to live adaptation behavior (`scorring_anomaly_sensitivity`).

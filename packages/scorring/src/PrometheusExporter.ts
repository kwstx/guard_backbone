import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface ScorringMetricsObservation {
    decisionScore: number;
    riskPressure: number;
    anomalySensitivity: number;
}

interface ScorringMetricsSnapshot extends ScorringMetricsObservation {
    updatedAtUnixSeconds: number;
    updatesTotal: number;
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
    const value = process.env[name];
    if (value === undefined) {
        return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
}

function readIntegerEnv(name: string, defaultValue: number): number {
    const value = process.env[name];
    if (value === undefined) {
        return defaultValue;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

export class ScorringPrometheusExporter {
    private static instance: ScorringPrometheusExporter | null = null;

    private readonly enabled: boolean;
    private readonly port: number;
    private readonly metricsPath: string;
    private server: Server | null = null;
    private snapshot: ScorringMetricsSnapshot = {
        decisionScore: 0,
        riskPressure: 0,
        anomalySensitivity: 1.0,
        updatedAtUnixSeconds: Math.floor(Date.now() / 1000),
        updatesTotal: 0
    };

    private constructor() {
        this.enabled = readBooleanEnv('SCORRING_METRICS_ENABLED', true);
        this.port = readIntegerEnv('SCORRING_METRICS_PORT', 9464);
        this.metricsPath = process.env.SCORRING_METRICS_PATH ?? '/metrics';
    }

    public static getInstance(): ScorringPrometheusExporter {
        if (!ScorringPrometheusExporter.instance) {
            ScorringPrometheusExporter.instance = new ScorringPrometheusExporter();
        }
        return ScorringPrometheusExporter.instance;
    }

    public observe(observation: ScorringMetricsObservation): void {
        if (!this.enabled) {
            return;
        }

        this.ensureServerStarted();
        this.snapshot = {
            decisionScore: this.clamp(observation.decisionScore, 0, 100),
            riskPressure: this.clamp(observation.riskPressure, 0, 1),
            anomalySensitivity: this.clamp(observation.anomalySensitivity, 0.5, 2.0),
            updatedAtUnixSeconds: Math.floor(Date.now() / 1000),
            updatesTotal: this.snapshot.updatesTotal + 1
        };
    }

    public setAnomalySensitivity(anomalySensitivity: number): void {
        if (!this.enabled) {
            return;
        }

        this.ensureServerStarted();
        this.snapshot = {
            ...this.snapshot,
            anomalySensitivity: this.clamp(anomalySensitivity, 0.5, 2.0),
            updatedAtUnixSeconds: Math.floor(Date.now() / 1000),
            updatesTotal: this.snapshot.updatesTotal + 1
        };
    }

    private ensureServerStarted(): void {
        if (this.server) {
            return;
        }

        this.server = createServer((req, res) => this.handleRequest(req, res));
        this.server.on('error', (error) => {
            console.error(`[ScorringPrometheusExporter] Failed to bind :${this.port}${this.metricsPath}`, error);
        });
        this.server.listen(this.port, () => {
            console.log(`[ScorringPrometheusExporter] Exporting metrics at http://localhost:${this.port}${this.metricsPath}`);
        });
    }

    private handleRequest(req: IncomingMessage, res: ServerResponse): void {
        const requestPath = (req.url ?? '').split('?')[0];
        if (requestPath !== this.metricsPath) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.end(this.renderPrometheusPayload());
    }

    private renderPrometheusPayload(): string {
        const s = this.snapshot;
        return [
            '# HELP scorring_decision_score Decision score in range [0, 100]. Higher means safer.',
            '# TYPE scorring_decision_score gauge',
            `scorring_decision_score ${s.decisionScore.toFixed(2)}`,
            '# HELP scorring_risk_pressure Composite risk pressure in range [0, 1]. Higher means stronger brakes.',
            '# TYPE scorring_risk_pressure gauge',
            `scorring_risk_pressure ${s.riskPressure.toFixed(6)}`,
            '# HELP scorring_anomaly_sensitivity Current anomaly sensitivity multiplier from threshold adaptation.',
            '# TYPE scorring_anomaly_sensitivity gauge',
            `scorring_anomaly_sensitivity ${s.anomalySensitivity.toFixed(6)}`,
            '# HELP scorring_metrics_updated_at_unix_seconds Last metrics update timestamp in unix seconds.',
            '# TYPE scorring_metrics_updated_at_unix_seconds gauge',
            `scorring_metrics_updated_at_unix_seconds ${s.updatedAtUnixSeconds}`,
            '# HELP scorring_metric_updates_total Number of metric updates emitted by scoring evaluations.',
            '# TYPE scorring_metric_updates_total counter',
            `scorring_metric_updates_total ${s.updatesTotal}`
        ].join('\n') + '\n';
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }
}

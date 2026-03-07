import logging
from prometheus_client import start_http_server, Gauge, Histogram, Counter

logger = logging.getLogger(__name__)

class PrometheusExporter:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(PrometheusExporter, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
            
        self.risk_pressure = Gauge(
            'risk_pressure',
            'Current system risk pressure'
        )
        self.simulation_latency = Histogram(
            'simulation_latency',
            'Latency of policy simulations',
            buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0]
        )
        self.blocked_actions = Counter(
            'blocked_actions',
            'Total number of actions blocked by enforcement'
        )
        
        self.port = None
        self._initialized = True

    def start_server(self, port: int):
        if self.port is not None:
            logger.warning(f"Metrics server already started on port {self.port}")
            return
        
        try:
            start_http_server(port)
            self.port = port
            logger.info(f"Started Prometheus metrics server on port {port}")
        except Exception as e:
            logger.error(f"Failed to start metrics server on port {port}: {e}")

    def record_risk_pressure(self, value: float):
        self.risk_pressure.set(value)

    def observe_simulation_latency(self, latency: float):
        self.simulation_latency.observe(latency)

    def increment_blocked_action(self):
        self.blocked_actions.inc()

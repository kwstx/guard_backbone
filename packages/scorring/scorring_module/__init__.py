import logging
from autonomy_core.interfaces import ScoringEngine, ActionAuthorizationRequest, ScoringResult
from autonomy_core.state import StateStore
from typing import Optional
from shared_utils.metrics import PrometheusExporter
import time

exporter = PrometheusExporter()

class ScoringModule(ScoringEngine):
    """Python bridge for the Scoring Module Node.js backend."""
    def __init__(self, state_store: Optional[StateStore] = None):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.state_store = state_store
        exporter.start_server(8001)

    async def calculate_score(self, action: ActionAuthorizationRequest, impact_score: float) -> ScoringResult:
        start_time = time.time()
        action_score = 0.8 + impact_score
        
        # Risk pressure increases with poor scores / negative impact. 
        # But this is just "calculating risk" directly based on the output.
        exporter.record_risk_pressure(action_score)
        
        self.logger.info(f"Calculating dynamic action score via TS implementation: {action_score}")
        if self.state_store:
            event_id = f"score_{id(action)}"
            req_data = getattr(action, "model_dump", lambda: action.__dict__)()
            await self.state_store.save_audit_event(event_id, {"type": "score_calculation", "score": action_score, "request": req_data})
            
        latency = time.time() - start_time
        exporter.observe_simulation_latency(latency)
        
        # Check blocking
        if action_score < 0.0:
            exporter.increment_blocked_action()
            
        return ScoringResult(action_score=action_score, threshold_met=action_score >= 0.0)

__version__ = "0.1.0"

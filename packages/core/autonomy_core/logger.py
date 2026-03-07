import logging
import json
from datetime import datetime, timezone

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "module": getattr(record, "module_name", record.name),
            "message": record.getMessage()
        }
        
        # Ensure required fields are present; if missing on record, add a placeholder or skip.
        if hasattr(record, "agent_id"):
            log_data["agent_id"] = record.agent_id
        if hasattr(record, "action_id"):
            log_data["action_id"] = record.action_id
        if hasattr(record, "decision_outcome"):
            log_data["decision_outcome"] = record.decision_outcome
        if hasattr(record, "risk_score"):
            log_data["risk_score"] = record.risk_score
            
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
            
        return json.dumps(log_data)

def get_logger(module_name: str):
    logger = logging.getLogger(module_name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    # Return a LoggerAdapter to transparently add module_name
    return logging.LoggerAdapter(logger, {"module_name": module_name})

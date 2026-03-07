import hashlib
import json
import time
import uuid
from typing import Dict, Any, Optional
from sqlalchemy import Column, String, Float, JSON, create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

Base = declarative_base()

class LedgerRecord(Base):
    __tablename__ = 'tamper_evident_ledger'
    
    id = Column(String, primary_key=True)
    timestamp = Column(Float, nullable=False)
    decision = Column(JSON, nullable=False)
    previous_hash = Column(String, nullable=True)
    hash = Column(String, unique=True, index=True, nullable=False)

class TamperEvidentLedger:
    def __init__(self, db_url="sqlite:///ledger.db"):
        self.engine = create_engine(db_url)
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def _calculate_hash(self, decision: Dict[str, Any], previous_hash: Optional[str], timestamp: float) -> str:
        """Calculates a SHA-256 hash across the payload and the previous hash."""
        payload = {
            "decision": decision,
            "previous_hash": previous_hash,
            "timestamp": timestamp
        }
        # sort_keys ensures consistent JSON stringification
        payload_str = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(payload_str.encode('utf-8')).hexdigest()

    def record_decision(self, decision_data: Dict[str, Any], decision_id: Optional[str] = None) -> str:
        """
        Records a decision and maintains the hash chain.
        Returns the hash of the new record.
        """
        session = self.SessionLocal()
        try:
            current_time = time.time()
            if not decision_id:
                decision_id = str(uuid.uuid4())
            
            # Fetch the current last hash to ensure atomicity
            latest = session.query(LedgerRecord).order_by(LedgerRecord.timestamp.desc()).first()
            previous_hash = latest.hash if latest else None
            
            # Deep copy to avoid mutating the original dictionary unexpectedly
            decision_copy = json.loads(json.dumps(decision_data))
            
            # The decision must include the hash of the preceding record in its metadata
            if "metadata" not in decision_copy:
                decision_copy["metadata"] = {}
            decision_copy["metadata"]["previous_hash"] = previous_hash
            
            # Compute new hash
            new_hash = self._calculate_hash(
                decision=decision_copy,
                previous_hash=previous_hash,
                timestamp=current_time
            )

            record = LedgerRecord(
                id=decision_id,
                timestamp=current_time,
                decision=decision_copy,
                previous_hash=previous_hash,
                hash=new_hash
            )
            
            session.add(record)
            session.commit()
            
            return new_hash
            
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def verify_chain(self) -> bool:
        """
        Verifies the cryptographic integrity of the entire ledger chain.
        Returns True if the chain is unbroken and untampered, False otherwise.
        """
        session = self.SessionLocal()
        try:
            records = session.query(LedgerRecord).order_by(LedgerRecord.timestamp.asc()).all()
            
            expected_previous_hash = None
            
            for record in records:
                # 1. Check link integrity
                if record.previous_hash != expected_previous_hash:
                    return False
                    
                # 2. Check metadata inclusion
                if record.decision.get("metadata", {}).get("previous_hash") != expected_previous_hash:
                    return False
                    
                # 3. Check cryptographic integrity
                calculated_hash = self._calculate_hash(
                    decision=record.decision,
                    previous_hash=record.previous_hash,
                    timestamp=record.timestamp
                )
                
                if calculated_hash != record.hash:
                    return False
                    
                expected_previous_hash = record.hash
                
            return True
        finally:
            session.close()

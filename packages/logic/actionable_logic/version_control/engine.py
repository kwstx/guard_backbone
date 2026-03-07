import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any, Tuple
from sqlalchemy.orm import sessionmaker
from sqlalchemy import func
from actionable_logic.repository.models import (
    DeploymentRecord, 
    AdoptionRecord, 
    DeploymentStatus, 
    AdoptionStatus, 
    get_engine, 
    init_db
)
from actionable_logic.repository.policy_repository import PolicyRepository
from actionable_logic.models.policy_schema import StructuredPolicy

class VersionControlEngine:
    """
    Manages the lifecycle of policy versions including deployment, testing,
    rollback, and agent-level adoption tracking.
    """
    def __init__(self, db_url="sqlite:///policy_repository.db"):
        self.engine = get_engine(db_url)
        init_db(self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.repository = PolicyRepository(db_url)

    def prepare_deployment(self, policy_id: str, version: str, environment: str = "staging") -> str:
        """
        Creates a deployment record in staging for testing.
        Ensures the policy exists in the repository first.
        """
        policy = self.repository.get_policy(policy_id, version)
        if not policy:
            raise ValueError(f"Policy {policy_id} v{version} not found in repository.")

        session = self.SessionLocal()
        try:
            deployment_id = str(uuid.uuid4())
            record = DeploymentRecord(
                id=deployment_id,
                policy_id=policy_id,
                version=version,
                status=DeploymentStatus.STAGING,
                environment=environment,
                created_at=datetime.utcnow()
            )
            session.add(record)
            session.commit()
            return deployment_id
        finally:
            session.close()

    def record_test_results(self, deployment_id: str, results: Dict[str, Any]):
        """
        Records the results of safety and compliance tests for a staging deployment.
        Moves status to TESTING.
        """
        session = self.SessionLocal()
        try:
            record = session.query(DeploymentRecord).filter(DeploymentRecord.id == deployment_id).first()
            if not record:
                raise ValueError(f"Deployment {deployment_id} not found")
            
            # Combine existing metadata with test results
            current_meta = record.metadata_json or {}
            current_meta["test_results"] = results
            current_meta["tested_at"] = datetime.utcnow().isoformat()
            
            record.metadata_json = current_meta
            record.status = DeploymentStatus.TESTING
            session.commit()
        finally:
            session.close()

    def promote_to_production(self, deployment_id: str):
        """
        Marks a tested staging deployment as PRODUCTION.
        Automatically updates previous production deployments to ARCHIVED.
        """
        session = self.SessionLocal()
        try:
            record = session.query(DeploymentRecord).filter(DeploymentRecord.id == deployment_id).first()
            if not record:
                raise ValueError(f"Deployment {deployment_id} not found")
            
            # Archive previous production deployment for this policy/environment
            session.query(DeploymentRecord).filter(
                DeploymentRecord.policy_id == record.policy_id,
                DeploymentRecord.environment == record.environment,
                DeploymentRecord.status == DeploymentStatus.PRODUCTION
            ).update({"status": DeploymentStatus.ARCHIVED})

            record.status = DeploymentStatus.PRODUCTION
            record.deployed_at = datetime.utcnow()
            session.commit()
            return record.id
        finally:
            session.close()

    def rollback(self, policy_id: str, environment: str = "production") -> str:
        """
        Rolls back to the most recent ARCHIVED or previous version.
        Safely transition states for auditing.
        """
        session = self.SessionLocal()
        try:
            # 1. Find current production record
            current = session.query(DeploymentRecord).filter(
                DeploymentRecord.policy_id == policy_id,
                DeploymentRecord.status == DeploymentStatus.PRODUCTION,
                DeploymentRecord.environment == environment
            ).first()

            if current:
                current.status = DeploymentStatus.ROLLED_BACK

            # 2. Find the previous version (the latest ARCHIVED one)
            previous = session.query(DeploymentRecord).filter(
                DeploymentRecord.policy_id == policy_id,
                DeploymentRecord.environment == environment,
                DeploymentRecord.status == DeploymentStatus.ARCHIVED
            ).order_by(DeploymentRecord.deployed_at.desc()).first()

            if not previous:
                raise ValueError(f"No previous versions found for policy {policy_id} to rollback to.")

            # 3. Create a new production record for the old version
            new_deployment_id = str(uuid.uuid4())
            rollback_record = DeploymentRecord(
                id=new_deployment_id,
                policy_id=policy_id,
                version=previous.version,
                status=DeploymentStatus.PRODUCTION,
                environment=environment,
                created_at=datetime.utcnow(),
                deployed_at=datetime.utcnow(),
                metadata_json={"reason": "manual_rollback", "rolled_back_from": current.version if current else None}
            )
            session.add(rollback_record)
            session.commit()
            return new_deployment_id
        finally:
            session.close()

    def track_adoption(self, agent_id: str, policy_id: str, version: str, compliance_score: Optional[Dict[str, Any]] = None):
        """
        Tracks which version of a policy an agent is currently executing.
        Historical states are preserved by marking previous records as SUPERSEDED.
        """
        session = self.SessionLocal()
        try:
            # Supersede previous active adoptions
            session.query(AdoptionRecord).filter(
                AdoptionRecord.agent_id == agent_id,
                AdoptionRecord.policy_id == policy_id,
                AdoptionRecord.status == AdoptionStatus.ACTIVE
            ).update({"status": AdoptionStatus.SUPERSEDED})
            
            record = AdoptionRecord(
                id=str(uuid.uuid4()),
                agent_id=agent_id,
                policy_id=policy_id,
                version=version,
                status=AdoptionStatus.ACTIVE,
                adopted_at=datetime.utcnow(),
                compliance_score=compliance_score
            )
            session.add(record)
            session.commit()
            return record.id
        finally:
            session.close()

    def get_adoption_analytics(self, policy_id: str, version: str) -> Dict[str, Any]:
        """
        Measures adoption spread and compliance impact of a specific version.
        Useful for auditing and safety verification.
        """
        session = self.SessionLocal()
        try:
            # Calculate total agents ever tracked (to get a baseline)
            active_agents = session.query(func.count(func.distinct(AdoptionRecord.agent_id))).scalar()
            
            # Agents on requested version
            version_adoptions = session.query(AdoptionRecord).filter(
                AdoptionRecord.policy_id == policy_id,
                AdoptionRecord.version == version,
                AdoptionRecord.status == AdoptionStatus.ACTIVE
            ).all()

            adoption_count = len(version_adoptions)
            
            # Compliance Score Extraction
            scores = []
            for a in version_adoptions:
                if a.compliance_score and "overall" in a.compliance_score:
                    scores.append(a.compliance_score["overall"])
            
            avg_compliance = sum(scores) / len(scores) if scores else 1.0 # Default to 1.0 if no violations
            
            return {
                "policy_id": policy_id,
                "version": version,
                "adoption_count": adoption_count,
                "adoption_velocity": adoption_count / active_agents if active_agents > 0 else 0,
                "compliance_impact": avg_compliance,
                "timestamp": datetime.utcnow().isoformat()
            }
        finally:
            session.close()

    def get_audit_trail(self, policy_id: str) -> List[Dict[str, Any]]:
        """
        Provides a complete historical trace of deployments for auditing.
        Ensures traceability of who/what was deployed and when.
        """
        session = self.SessionLocal()
        try:
            records = session.query(DeploymentRecord).filter(
                DeploymentRecord.policy_id == policy_id
            ).order_by(DeploymentRecord.created_at.desc()).all()
            
            return [
                {
                    "deployment_id": r.id,
                    "version": r.version,
                    "status": r.status.value,
                    "environment": r.environment,
                    "created_at": r.created_at.isoformat(),
                    "deployed_at": r.deployed_at.isoformat() if r.deployed_at else None,
                    "metadata": r.metadata_json
                }
                for r in records
            ]
        finally:
            session.close()

    def compare_compliance_impact(self, policy_id: str, old_version: str, new_version: str) -> Dict[str, Any]:
        """
        Compares the compliance impact between two versions of the same policy.
        Helps identify if a new update improved or degraded agent alignment.
        """
        session = self.SessionLocal()
        try:
            # We need to look at historical records, not just active ones for the old version
            # because the old version might be mostly SUPERSEDED now.
            def get_avg_score(v):
                recs = session.query(AdoptionRecord).filter(
                    AdoptionRecord.policy_id == policy_id,
                    AdoptionRecord.version == v
                ).all()
                scores = [r.compliance_score.get("overall", 0) for r in recs if r.compliance_score]
                return sum(scores) / len(scores) if scores else 0.0

            old_score = get_avg_score(old_version)
            new_score = get_avg_score(new_version)
            
            delta = new_score - old_score
            
            return {
                "policy_id": policy_id,
                "old_version": old_version,
                "new_version": new_version,
                "old_compliance": old_score,
                "new_compliance": new_score,
                "compliance_delta": delta,
                "impact_direction": "improved" if delta > 0.001 else "degraded" if delta < -0.001 else "stable"
            }
        finally:
            session.close()

    def list_agent_policy_compliance(self, agent_id: str) -> List[Dict[str, Any]]:
        """Lists all policies currently active for a specific agent and their compliance states."""
        session = self.SessionLocal()
        try:
            records = session.query(AdoptionRecord).filter(
                AdoptionRecord.agent_id == agent_id,
                AdoptionRecord.status == AdoptionStatus.ACTIVE
            ).all()
            
            return [
                {
                    "policy_id": r.policy_id,
                    "version": r.version,
                    "adopted_at": r.adopted_at.isoformat(),
                    "compliance_score": r.compliance_score
                }
                for r in records
            ]
        finally:
            session.close()

    def get_deployment_status(self, policy_id: str, environment: str = "production") -> Optional[Dict[str, Any]]:
        """Returns the currently active deployment for a policy."""
        session = self.SessionLocal()
        try:
            record = session.query(DeploymentRecord).filter(
                DeploymentRecord.policy_id == policy_id,
                DeploymentRecord.status == DeploymentStatus.PRODUCTION,
                DeploymentRecord.environment == environment
            ).first()
            
            if not record:
                return None
            
            return {
                "deployment_id": record.id,
                "version": record.version,
                "deployed_at": record.deployed_at.isoformat() if record.deployed_at else None,
                "environment": record.environment
            }
        finally:
            session.close()

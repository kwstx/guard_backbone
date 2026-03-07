import uuid
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import and_, or_
from .models import PolicyRecord, get_engine, init_db
from ..models.policy_schema import StructuredPolicy, PolicyDomain, PolicyScope

class PolicyRepository:
    def __init__(self, db_url="sqlite:///policy_repository.db"):
        self.engine = get_engine(db_url)
        init_db(self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def _to_record(self, policy: StructuredPolicy) -> PolicyRecord:
        content = {
            "conditions": [c.model_dump() for c in policy.conditions],
            "triggers": [t.model_dump() for t in policy.triggers],
            "exceptions": [e.model_dump() for e in policy.exceptions],
            "instructions": policy.instructions
        }
        return PolicyRecord(
            id=str(uuid.uuid4()),
            policy_id=policy.policy_id,
            version=policy.version,
            title=policy.title,
            domain=policy.domain.value,
            scope=policy.scope.value,
            industry=policy.industry,
            compliance_type=policy.compliance_type,
            functional_area=policy.functional_area,
            is_template=policy.is_template,
            template_id=policy.template_id,
            effective_date=policy.effective_date,
            content_json=content,
            raw_source=policy.raw_source,
            rationale=policy.rationale
        )

    def _to_pydantic(self, record: PolicyRecord) -> StructuredPolicy:
        return StructuredPolicy(
            policy_id=record.policy_id,
            title=record.title,
            version=record.version,
            domain=PolicyDomain(record.domain),
            scope=PolicyScope(record.scope),
            industry=record.industry,
            compliance_type=record.compliance_type,
            functional_area=record.functional_area,
            is_template=record.is_template,
            template_id=record.template_id,
            effective_date=record.effective_date,
            conditions=record.content_json.get("conditions", []),
            triggers=record.content_json.get("triggers", []),
            exceptions=record.content_json.get("exceptions", []),
            instructions=record.content_json.get("instructions", []),
            raw_source=record.raw_source,
            rationale=record.rationale
        )

    def save_policy(self, policy: StructuredPolicy):
        """Stores a policy in the repository."""
        session = self.SessionLocal()
        try:
            record = self._to_record(policy)
            session.add(record)
            session.commit()
            return record.id
        finally:
            session.close()

    def get_policy(self, policy_id: str, version: Optional[str] = None) -> Optional[StructuredPolicy]:
        """Retrieves a specific policy by ID and optionally version. If version is None, get latest."""
        session = self.SessionLocal()
        try:
            query = session.query(PolicyRecord).filter(PolicyRecord.policy_id == policy_id)
            if version:
                query = query.filter(PolicyRecord.version == version)
            else:
                query = query.order_by(PolicyRecord.created_at.desc())
            
            record = query.first()
            return self._to_pydantic(record) if record else None
        finally:
            session.close()

    def list_policies(self, 
                      industry: Optional[str] = None, 
                      compliance_type: Optional[str] = None, 
                      functional_area: Optional[str] = None,
                      domain: Optional[str] = None,
                      is_template: Optional[bool] = None) -> List[StructuredPolicy]:
        """Queries policies by various filters."""
        session = self.SessionLocal()
        try:
            query = session.query(PolicyRecord)
            if industry:
                query = query.filter(PolicyRecord.industry == industry)
            if compliance_type:
                query = query.filter(PolicyRecord.compliance_type == compliance_type)
            if functional_area:
                query = query.filter(PolicyRecord.functional_area == functional_area)
            if domain:
                query = query.filter(PolicyRecord.domain == domain)
            if is_template is not None:
                query = query.filter(PolicyRecord.is_template == is_template)
            
            records = query.all()
            return [self._to_pydantic(r) for r in records]
        finally:
            session.close()

    def clone_template(self, template_id: str, new_policy_id: str, updates: Dict[str, Any]) -> StructuredPolicy:
        """Clones a template and applies domain-specific adaptations."""
        template = self.get_policy(template_id)
        if not template:
            raise ValueError(f"Template with id {template_id} not found")
        
        # Create a new policy object from template
        policy_data = template.model_dump()
        policy_data["policy_id"] = new_policy_id
        policy_data["is_template"] = False
        policy_data["template_id"] = template_id
        policy_data["version"] = "1.0.0"
        
        # Apply updates (e.g., industry, compliance specific logic)
        for key, value in updates.items():
            if key in policy_data:
                policy_data[key] = value
        
        new_policy = StructuredPolicy(**policy_data)
        self.save_policy(new_policy)
        return new_policy

    def get_version_history(self, policy_id: str) -> List[Dict[str, str]]:
        """Returns the version history for a policy."""
        session = self.SessionLocal()
        try:
            records = session.query(PolicyRecord).filter(PolicyRecord.policy_id == policy_id).order_by(PolicyRecord.created_at.desc()).all()
            return [{"version": r.version, "created_at": r.created_at.isoformat(), "title": r.title} for r in records]
        finally:
            session.close()


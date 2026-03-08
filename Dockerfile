FROM python:3.11-slim

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y gcc curl && rm -rf /var/lib/apt/lists/*

# Copy the entire workspace
COPY . /workspace/

# Install dependencies manually to avoid hatchling build issues in the container
RUN pip install --no-cache-dir \
    fastapi \
    pydantic \
    urllib3 \
    uvicorn \
    prometheus-client \
    stripe \
    python-terraform \
    cryptography \
    opa-python \
    sqlalchemy

# Install local packages as editables manually in correct dependency order
RUN pip install -e ./packages/shared_utils
RUN pip install -e ./packages/core
RUN pip install -e ./packages/enforcement
RUN pip install -e ./packages/scoring
RUN pip install -e ./packages/logic
RUN pip install -e ./packages/sdk

# Expose the API port
EXPOSE 8000

# Start the Gateway Service using uvicorn directly on the file path
CMD ["uvicorn", "apps.gateway.gateway_service.app:app", "--host", "0.0.0.0", "--port", "8000"]

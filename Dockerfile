FROM python:3.11-slim

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y gcc curl && rm -rf /var/lib/apt/lists/*

# Copy the entire workspace to install local packages
COPY . /workspace/

# Install dependencies defined in pyproject.toml
RUN pip install --no-cache-dir -e .

# Expose the API port
EXPOSE 8000

# Start the Gateway Service
CMD ["uvicorn", "apps.gateway.gateway_service.app:app", "--host", "0.0.0.0", "--port", "8000"]

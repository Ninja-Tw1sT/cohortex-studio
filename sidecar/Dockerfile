# Cloud Run image for the Cohortex sidecar. Not deployed by default in the
# public demo (see DEPLOY.md — production runs replay-only, no LLM backend
# wired up), but kept ready for when a cloud LLM key is added.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]

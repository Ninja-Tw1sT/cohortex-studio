# Cloud Run image for the Cohortex sidecar. Not deployed by default in the
# public demo (see DEPLOY.md — production runs replay-only, no LLM backend
# wired up), but kept ready for when a cloud LLM key is added.
FROM python:3.12-slim

WORKDIR /app

# git is needed at build time only, to pip-install the pinned `cohortex @
# git+https://...` dependency in requirements.txt — python:3.12-slim doesn't
# ship it. Not needed at runtime, so this doesn't bloat the final image beyond
# apt's own footprint (no separate multi-stage copy — simplicity over the
# few extra MB for a low-traffic portfolio deploy).
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]

# Deploying Cohortex Studio

Target architecture (chosen to stay at $0/month for portfolio-level traffic):

- **Frontend** — Firebase Hosting (static Angular build, free tier)
- **Backend** — Cloud Run (Express API, scales to zero, free tier covers low traffic)
- **Database** — MongoDB Atlas free M0 cluster
- **Sidecar** — a second Cloud Run service, `--allow-unauthenticated` behind a shared-secret
  header (`SIDECAR_SHARED_KEY`). It holds no LLM keys of its own — the public demo stays
  replay-only by default (`LIVE_RUNS_ENABLED=false`), and a visitor who brings their own key
  via the LLM Config page unlocks live runs at zero cost to you.

Run every command below yourself, in your own authenticated terminal (or Google Cloud Shell —
see note in Step 2). Steps that need browser sign-in can't be driven from here.

## 1. MongoDB Atlas (free M0 cluster)

1. Sign up / log in at https://cloud.mongodb.com.
2. Create a project, then **Build a Database → M0 Free**.
3. Database Access → add a user (username + password, "Read and write to any database").
4. Network Access → Add IP Address → **Allow Access from Anywhere** (`0.0.0.0/0`). Cloud Run's
   outbound IPs aren't static, so this is the standard approach — the strong password plus
   TLS-by-default is the real protection.
5. Connect → Drivers → copy the `mongodb+srv://...` connection string. Replace `<password>` with
   your real password (URL-encode any special characters) and the db name with `cohortex_studio`.

Keep that URI handy for Step 3.

## 2. Enable GCP billing + APIs

The `cohortex-studio` Firebase project is already a GCP project.

1. https://console.cloud.google.com/billing → link a billing account to the `cohortex-studio`
   project. (Required to use Cloud Run at all, even within the free tier.)
2. Enable APIs (or let the first `gcloud run deploy` prompt you to enable them):
   ```
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   ```

**No local install needed:** open https://shell.cloud.google.com — it's browser-based, already
signed in as you, and has `gcloud` preinstalled. Clone the repo there and run the commands below
instead of installing the Cloud SDK locally.

## 3. Deploy the backend to Cloud Run

From the repo root (or Cloud Shell after `git clone`):

```bash
gcloud config set project cohortex-studio

cd backend
gcloud run deploy cohortex-studio-api \
  --source=. \
  --region=us-central1 \
  --allow-unauthenticated \
  --set-env-vars="MONGODB_URI=<your Atlas URI>,LIVE_RUNS_ENABLED=false,ALLOWED_ORIGINS=https://cohortex-studio.web.app,https://cohortex-studio.firebaseapp.com"
```

`--source=.` builds the `backend/Dockerfile` via Cloud Build — no local Docker needed either.
No `GOOGLE_APPLICATION_CREDENTIALS` or service account key required: Cloud Run's attached runtime
service account provides Application Default Credentials automatically, which is all
`firebase-admin`'s `verifyIdToken` needs.

The command prints a **Service URL** when it finishes (something like
`https://cohortex-studio-api-xxxxx-uc.a.run.app`). Send that URL back so `environment.prod.ts` can
be updated with it.

## 3b. Deploy the sidecar to Cloud Run (enables BYOK live runs)

First-time deploy of a second Cloud Run service. Generate a shared secret so only your backend
can call it:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Then, from `sidecar/`:

```bash
cd sidecar
gcloud run deploy cohortex-studio-sidecar \
  --source=. \
  --region=us-central1 \
  --allow-unauthenticated \
  --set-env-vars="SIDECAR_SHARED_KEY=<the generated secret>"
```

Intentionally no cloud-provider API keys go here — this deployment only ever serves
visitor-supplied `llmOverrides`. `--allow-unauthenticated` is required for Cloud Run to route the
request at all, but every `/run`, `/runs/{id}`, `/runs/{id}/events`, and `/backends` call is then
gated behind the `X-Sidecar-Key` header (`require_shared_key` in `app/main.py`).

**Accepted v1 gap:** anyone who finds this Service URL and guesses/leaks the shared key could hit
`/run` directly, bypassing the backend's `runLimiter` rate limiter — the sidecar has no rate
limiting of its own. Low-stakes given the sidecar holds no secrets and has no DB connection (worst
case: someone starts a crew run using their own supplied key, which they could do legitimately via
the real frontend anyway). Revisit with IAM `roles/run.invoker` + ID tokens if that ever changes.

Record the printed **Service URL**, then update the backend with it plus the same shared key:

```bash
gcloud run services update cohortex-studio-api \
  --region=us-central1 \
  --update-env-vars="SIDECAR_URL=<sidecar service URL>,SIDECAR_SHARED_KEY=<the same generated secret>"
```

`LIVE_RUNS_ENABLED` stays `false` — deliberately unrelated to this feature. Server-funded live
runs remain off; visitor-keyed live runs bypass that flag entirely once every agent in a crew has
a covered `llmOverrides` entry (enforced in `backend/src/routes/runs.js`).

## 4. Seed demo data against Atlas

Once the Atlas URI works, seed it once (from your machine or Cloud Shell):

```bash
cd backend
MONGODB_URI="<your Atlas URI>" npm run seed
```

## 5. Deploy the frontend to Firebase Hosting

```bash
npm install -g firebase-tools   # or use npx firebase-tools for every command below
firebase login                 # one-time browser sign-in

cd frontend
npm run build -- --configuration production
cd ..
firebase deploy --only hosting
```

This publishes to `https://cohortex-studio.web.app` and `https://cohortex-studio.firebaseapp.com`
(both are set in the backend's `ALLOWED_ORIGINS` above already). Redeploy this step whenever
frontend code changes, including the LLM Config page and per-agent assignment UI added for BYOK.

## 6. Verify

- Visit the Hosting URL, confirm demo agents/crews load anonymously and a replay run streams.
- Confirm Google Sign-In works and gates mutation UI / live mode as expected.
- `curl -X POST <cloud-run-url>/api/agents` with no auth header should still 401.
- BYOK: sign in, add a real or Ollama-hosted-elsewhere credential in LLM Config, assign it to
  every agent in a crew, switch to live mode, and confirm the run actually streams — this proves
  `LIVE_RUNS_ENABLED=false` is correctly bypassed and the sidecar is reachable and authenticating
  against `SIDECAR_SHARED_KEY` correctly.

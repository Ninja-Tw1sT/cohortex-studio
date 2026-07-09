# Deploying Cohortex Studio

Target architecture (chosen to stay at $0/month for portfolio-level traffic):

- **Frontend** — Firebase Hosting (static Angular build, free tier)
- **Backend** — Cloud Run (Express API, scales to zero, free tier covers low traffic)
- **Database** — MongoDB Atlas free M0 cluster
- **Sidecar** — **not deployed**. The public demo runs replay-only (`LIVE_RUNS_ENABLED=false`),
  so there's no LLM backend to pay for or keep warm. `sidecar/Dockerfile` exists for when you're
  ready to wire in a cloud LLM key and deploy it as a second Cloud Run service.

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
(both are set in the backend's `ALLOWED_ORIGINS` above already).

## 6. Verify

- Visit the Hosting URL, confirm demo agents/crews load anonymously and a replay run streams.
- Confirm Google Sign-In works and gates mutation UI / live mode as expected.
- `curl -X POST <cloud-run-url>/api/agents` with no auth header should still 401.

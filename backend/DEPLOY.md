# Deploying render

Two pieces, two hosts:

- **Frontend** (the Vite app at the repo root) → **Vercel**.
- **Backend** (this folder: seller + orchestrator) → **Render.com** free web service.

They can't share a host: the backend runs headless Chromium and a long-lived SSE
stream, which Vercel's serverless functions can't do.

---

## 1. Backend → Render.com

The repo ships a [`Dockerfile`](./Dockerfile) and a [`render.yaml`](../render.yaml)
blueprint. Both services run in **one container, one Node process** — the seller
internal on `:4000`, the orchestrator public on Render's `$PORT`.

1. Push this repo to GitHub (already done).
2. Render dashboard → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Render will prompt for the secrets (`sync:false` in the blueprint). Paste the
   values from your local `backend/.env.local`:
   - `SELLER_ADDRESS`, `SELLER_PRIVATE_KEY`
   - `AGENT_ADDRESS`, `AGENT_PRIVATE_KEY`
   - `DEEPSEEK_API_KEY`
4. Deploy. First build takes a few minutes (it installs Chromium). When it's
   live you get a URL like `https://render-agent.onrender.com`.
5. Sanity check: open `https://render-agent.onrender.com/health` → `{ "ok": true }`.

**Free-tier notes**

- 512 MB RAM. The single-process layout + low-memory Chromium flags keep one
  page render inside that. If you see OOM restarts under load, that's the ceiling.
- Sleeps after ~15 min idle (~50s cold start). The
  [`keep-warm` workflow](../.github/workflows/keepalive.yml) pings `/health`
  every 10 min — set repo **Variable** `ORCHESTRATOR_URL` to the Render URL to
  enable it. (Or point cron-job.org at `<url>/health`.)

---

## 2. Frontend → Vercel

1. Vercel → **New Project** → the same repo. Framework preset **Vite** is
   auto-detected; root dir `./`, build `npm run build`, output `dist` — all default.
2. Add an environment variable:
   - `VITE_ORCHESTRATOR_URL` = the Render URL (e.g. `https://render-agent.onrender.com`)
3. Deploy.

`VITE_*` vars are **public** (baked into the JS bundle) — only the orchestrator
URL goes here. Wallet keys and the DeepSeek key live **only** on Render.

---

## Before going fully public

`POST /task` spends the agent's real wallet and has no per-caller limit yet. Each
task is capped (~`maxPagesPerTask × $0.001` ≈ $0.012), but nothing stops a flood
of tasks from draining the balance. Add a per-IP rate limit + daily spend ceiling
before sharing the URL widely. (Testnet USDC refills free at faucet.circle.com.)

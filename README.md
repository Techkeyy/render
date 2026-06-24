# render

**An autonomous agent that runs your internet errands — on a budget it can't cross.**

Give render a goal and a spending cap. It goes out, opens the pages itself —
even the modern, JavaScript-heavy ones other assistants can't read — pays a
fraction of a cent per page as it goes, and comes back with one answer plus a
receipt of every fare it paid. The budget is the leash: it can spend up to the
cap and not a cent more.

Built for the **Lepton Agents Hackathon** (Canteen × Circle × Arc).

## Live demo

- **App:** <https://render-kmjq.vercel.app/>
- **Backend:** <https://render-agent-neup.onrender.com> (free tier — ~50s cold start)
- **Agent wallet:** [`0x5E64243D492183958595C64Be9609642BDF4cF11`](https://testnet.arcscan.app/address/0x5E64243D492183958595C64Be9609642BDF4cF11)

No wallet needed. No sign-up. The agent pays from its own USDC on Arc Testnet.

---

## The idea in one line

Most AI assistants hit a modern website and see a blank wall — the page never
finishes loading for them. render opens each page in a real browser, and because
that costs real compute, it **pays for each one** — `$0.001` in USDC, settled
on **Arc** via **x402 + Circle Gateway**. Sub-cent, per-action, no subscription,
no card on file.

```
  you ──(goal + budget)──►  orchestrator  (plan → assess → synthesize)
                                  │  pays $0.001 USDC per page  (x402, Arc)
                                  ▼
                            render-service  (Playwright) ──► page text
                                  │
  you ◄──(answer + receipt)──◄────┘
```

The economic decision is the point: after each page, the agent asks *"given what
I now know and how much budget is left, is opening the next page worth the
fare?"* — so it spends like something with a wallet, not a script running a
fixed list.

---

## Architecture

| Layer | What it does |
|---|---|
| **frontend** (`/src`) | Vite + React landing page and the live task console (watch the agent pay its way, fare by fare). |
| **render-service** (`backend/src/render-service.ts`) | The **seller**. An x402-paywalled `GET /render?url=`. Pay `$0.001` USDC and it renders the page in headless Chromium and returns the human-visible text. SSRF-guarded. |
| **orchestrator** (`backend/src/orchestrator.ts`) | The **buyer agent**. Given a goal + budget, plans which pages are worth opening, pays the render-service per page, decides after each whether it has enough, and synthesizes the answer — streaming the live receipt over SSE. |
| **brain** (`backend/src/brain.ts`) | `plan()` · `assess()` (the spend decision) · `synthesize()`. OpenAI-compatible; **DeepSeek** `deepseek-chat` by default. |

**Stack:** Arc Testnet (`eip155:5042002`) · Circle Gateway / x402-batching ·
USDC (`0x3600…0000`) · Playwright · DeepSeek · viem · Express · React + Vite.

**Deploy:** Frontend on Vercel, backend on Render.com (single-process Docker
container — seller + orchestrator in one Node process to fit 512 MB free tier).

---

## Run it locally

### Backend

```bash
cd backend
npm install
npx playwright install chromium
npm run generate-wallets          # writes seller + agent keys to .env.local
```

1. Fund the **agent** wallet with Arc Testnet USDC at <https://faucet.circle.com/>
   (this pays for renders + gas).
2. Add `DEEPSEEK_API_KEY=...` to `backend/.env.local` (the agent's brain).

```bash
npm run render-service            # seller  on :4000
npm run orchestrator              # buyer   on :4100
```

Run an errand from the terminal (streams the receipt as it pays):

```bash
curl -N -X POST http://localhost:4100/task \
  -H 'content-type: application/json' \
  -d '{"goal":"Which laptop is cheapest?",
       "seedUrls":["https://webscraper.io/test-sites/e-commerce/ajax/computers/laptops"],
       "budgetUsdc":0.01}'
```

### Frontend

```bash
npm install
npm run dev                       # http://localhost:5173
```

---

## Status

- [x] `render-service` — x402-paywalled Playwright renderer, SSRF-guarded.
- [x] `AgentWallet` — Circle Gateway deposit + pay-per-render.
- [x] Agent brain — DeepSeek `plan` / `assess` / `synthesize`, JSON-validated.
- [x] `orchestrator` — budget-bounded task loop, SSE live receipt.
- [x] End-to-end on real money — real Arc settlements, answer returned, budget respected.
- [x] Landing page — editorial light theme, live agent balance in nav.
- [x] Live task console — type a goal + budget, watch the agent plan, pay, and answer live.
- [x] Zero-friction visitor experience — the agent pays from its own wallet, no sign-up needed.
- [x] Receipt — Circle Gateway settlement ref per fare + on-chain wallet link.
- [x] Rate limiting — per-IP cap + wallet floor guard.
- [x] Deployed — frontend (Vercel) + backend (Render.com).
- [ ] Record demo video and submit.

---

## Endpoints

- `render-service` — `GET /health`, `GET /render?url=` (paywalled `$0.001`)
- `orchestrator` — `GET /health`, `GET /balance`, `POST /task` (SSE stream of
  `plan → open → paid → finding → stop → answer`)

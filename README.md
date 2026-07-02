# render

**An autonomous agent that runs your internet errands — on a budget it can't cross.**

Give render a goal and a spending cap. It opens the pages itself — even the
modern, JavaScript-heavy ones other AI assistants can't read — pays a fraction
of a cent per page as it goes, and comes back with one answer plus a receipt
of every fare it paid. The budget is the leash: it can spend up to the cap
and not a cent more.

Built for the **Lepton Agents Hackathon** (Canteen x Circle x Arc).

## Live demo

| | |
|---|---|
| **App** | <https://render-kmjq.vercel.app/> |
| **For publishers** | <https://render-kmjq.vercel.app/publishers> — get paid when agents read your site |
| **Backend** | <https://render-agent-neup.onrender.com> (free tier — kept warm by a GitHub Action) |
| **Agent wallet** | [`0x5E64243D492183958595C64Be9609642BDF4cF11`](https://testnet.arcscan.app/address/0x5E64243D492183958595C64Be9609642BDF4cF11) |

No sign-up required — the agent pays from its own wallet.
Sign in to get your own wallet on Arc and unlimited errands.

---

## The problem

You want to compare prices across five stores before buying a PS5. Or check
eight apartment listings for pet policies. Or find the cheapest Friday flight
to Lagos across three airline sites.

Right now, that means opening tab after tab, waiting for each page to load,
skimming through each one, and mentally stitching together the answer yourself.
It's boring, repetitive work — death by a thousand tabs.

AI assistants should help with this, but most of them hit a modern website and
see a blank wall. The page uses JavaScript to load its content, and the
assistant's simple fetch request never runs that JavaScript — so it sees
nothing.

## How render solves it

render opens each page in a real browser (headless Chromium), exactly the way
you would. It waits for the JavaScript to run, the prices to load, the content
to appear — then reads the human-visible text.

Because opening a real browser costs real computing power, render **pays for
each page** — `$0.001` USDC (a tenth of a cent), settled instantly on **Arc**
blockchain via **x402** and **Circle Gateway**. Sub-cent, per-action, no
subscription, no card on file.

The economic decision is the point: after each page, the agent asks *"given
what I now know and how much budget is left, is opening the next page worth
the fare?"* — so it spends like something with a wallet, not a script running
a fixed list.

```
  you ──(goal + budget)──►  orchestrator  (plan → assess → synthesize)
                                  │  pays $0.001 USDC per page  (x402, Arc)
                                  ▼
                            render-service  (Playwright) ──► page text
                                  │
  you ◄──(answer + receipt)──◄────┘
```

## What makes it different

- **It can actually see modern websites.** Most AI tools fetch a URL and get
  back raw HTML — if the page loads its content with JavaScript, they see
  nothing. render opens a real browser, so it reads whatever a human would see.

- **It pays for what it reads.** Every page costs `$0.001` in real USDC on Arc.
  No subscription, no monthly bill — you pay for the peeking, nothing more.

- **Publishers get paid too.** When render reads a page, it checks for a
  `/.well-known/x402.json` file on that domain. If the site owner has published
  their USDC wallet there, the agent tips them automatically — a real, separate
  settlement on Arc. One file on your domain and AI agents start paying you
  for your content. No registration, no middleman.

- **The budget is a hard ceiling.** Set a cap of $0.02 and the agent literally
  cannot spend more. Any unspent budget stays in the wallet.

- **You watch it work, live.** Every fare, every page, every finding streams to
  your screen in real time as the agent works through the task.

---

## Features

| Feature | What it does |
|---|---|
| **Live task console** | Type a goal + budget, watch the agent plan, pay, and answer — fare by fare, in real time. |
| **Wallet sign-in** | Create a wallet or log in with a username (Circle Programmable Wallets, PIN auth). Accounts, history, and watches persist server-side. |
| **User-funded errands** | Signed-in users PIN-approve a USDC transfer of the budget from *their* wallet; the agent runs on it and refunds the unspent part on-chain at task end. Or flip the toggle and let the agent's wallet pay. |
| **Budget tiers** | Anonymous errands cap at $0.02 (shared agent wallet); signed-in users go to $0.50 on their own money. |
| **Errand history** | Every task is recorded under the account — goal, answer, receipt, spend — shown in a "Your errands" panel. |
| **Share permalinks** | Every completed errand gets a public link (`/r/:id`): answer, citations, and the on-chain receipt, plus a run-your-own CTA. |
| **Watch mode** | Set a task to re-run on a schedule — "tell me when this price drops below $80." Account-owned, cancellable, survives backend restarts. |
| **Citations** | Every claim in the answer links back to the source URL that grounded it. |
| **Structured output** | Request typed JSON fields and get machine-readable data back alongside the natural-language answer. |
| **Publisher tipping** | Sites that publish a `/.well-known/x402.json` receive a USDC tip every time the agent reads their content. |
| **Publisher onboarding** | `/publishers`: generate your x402.json, step-by-step hosting directions, a live "verify my site" check, and a leaderboard of publishers actually paid. |
| **Stealth renderer** | UA rotation, anti-fingerprinting, cookie-banner dismissal, resource blocking — the agent gets past the same defenses that block simpler scrapers. |
| **Cold-start UX** | "Waking up the agent..." indicator + a keep-warm GitHub Action pinging the free-tier backend. |

---

## Architecture

| Layer | What it does |
|---|---|
| **frontend** (`/src`) | Vite + React landing page, live task console, wallet sign-in UI. |
| **render-service** (`backend/src/render-service.ts`) | The **seller**. An x402-paywalled `GET /render?url=`. Pay `$0.001` and it renders the page in headless Chromium and returns the human-visible text. SSRF-guarded. |
| **orchestrator** (`backend/src/orchestrator.ts`) | The **buyer agent**. Given a goal + budget, plans which pages to open, pays the render-service per page, decides after each whether to continue, and synthesizes the answer — streaming the live receipt over SSE. |
| **brain** (`backend/src/brain.ts`) | `plan()` · `assess()` (the spend-or-stop decision) · `synthesize()`. OpenAI-compatible; **DeepSeek** by default. |
| **auth** (`backend/src/auth.ts`) | Circle Programmable Wallets integration — user creation, log-in, wallet init on Arc Testnet, and user-initiated funding transfers (PIN-approved). |
| **store** (`backend/src/store.ts`) | Persistence for stats, errand history, watches, and accounts. Local JSON file by default; Upstash Redis (REST) when configured — survives redeploys. |
| **publishers** (`backend/src/publishers.ts`) | `/.well-known/x402.json` discovery (how the agent finds who to tip) + the live verify used by the onboarding page. |

**Stack:**
Arc Testnet (`eip155:5042002`) · Circle Gateway / x402-batching ·
Circle Programmable Wallets SDK · USDC (`0x3600…0000`) ·
Playwright (stealth) · DeepSeek · viem · Express · React + Vite.

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
3. *(Optional — enables wallet sign-in)* Add to `backend/.env.local`:
   ```
   CIRCLE_API_KEY=...          # from console.circle.com → Keys → Create API key
   ```
   And add to the frontend `.env.local`:
   ```
   VITE_CIRCLE_APP_ID=...      # from console.circle.com → Wallets → User Controlled → Configurator
   ```
4. *(Optional — makes the ledger survive redeploys)* Add to `backend/.env.local`:
   ```
   UPSTASH_REDIS_REST_URL=...   # console.upstash.com → your database → REST API
   UPSTASH_REDIS_REST_TOKEN=...
   ```
   Without these, stats/history/watches persist to a local JSON file instead.

```bash
npm run render-service            # seller  on :4000
npm run orchestrator              # buyer   on :4100
```

Run an errand from the terminal:

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
- [x] Rate limiting — per-IP cap (3/hr free, unlimited with wallet) + wallet floor guard.
- [x] Deployed — frontend (Vercel) + backend (Render.com).
- [x] Watch mode — re-run a task on a schedule, alert when the answer changes.
- [x] Citations — every claim in the answer cites the source URL that grounded it.
- [x] Structured output — request typed JSON fields and get machine-readable data back.
- [x] Stealth renderer — UA rotation, anti-fingerprinting, cookie-banner dismissal, resource blocking.
- [x] Live stats counter — errands, unique users, USDC settled, shown on the landing page.
- [x] Wallet sign-in — Circle Programmable Wallets SDK (PIN auth), username log-in, embedded wallet on Arc Testnet, USDC balance, unlimited errands.
- [x] Cold-start UX — "waking up the agent..." indicator + keep-warm GitHub Action.
- [x] Publisher tipping — sites that publish `/.well-known/x402.json` receive automatic USDC tips.
- [x] User-funded errands — PIN-approved budget transfer from the user's wallet, on-chain refund of the unspent part, server-side verification + replay guard.
- [x] Persistent ledger — stats, history, watches, and accounts survive restarts (and redeploys with Upstash).
- [x] Errand history — per-account past answers + receipts (`/history`).
- [x] Share permalinks — public errand pages (`/r/:id`) with the on-chain receipt.
- [x] Budget tiers — $0.02 anonymous / $0.50 signed-in, enforced server-side.
- [x] Publisher onboarding — `/publishers` generator, live verify, tips leaderboard. First organic publisher onboarded and tipped (predict fun).
- [ ] Record demo video and submit.

---

## Known limitations (hackathon scope)

Deliberate shortcuts, disclosed:

- **Usernames are not authenticated.** The `x-render-user` header is client-supplied — anyone claiming a username can read that account's errand history and cancel its watches. Wallet *funds* are still safe (moving money always needs the Circle PIN), but history/watches are best-effort identity. Production fix: bind requests to the Circle user token.
- **Usernames are first-come, no recovery.** Forgot your username? That account's history is orphaned.
- **User funding flows through the agent's wallet.** The budget transfer lands in the agent's own address and refunds come from it — custodial in all but name for the duration of a task. Production fix: per-task escrow contract.
- **Single Node process.** A crash loses in-flight tasks (completed ones are already persisted).
- **Testnet only.** All USDC is Arc Testnet USDC from the faucet.

---

## Endpoints

- `render-service` — `GET /health`, `GET /render?url=` (paywalled `$0.001`), `GET /tip?wallet=&name=` (paywalled `$0.001`, pays the publisher)
- `orchestrator`:
  - `GET /health` (includes active store backend), `GET /balance`, `GET /stats`
  - `POST /task` — SSE stream: `funded? → plan → open → paid → tipped → finding → stop → answer → refunded? → recorded`
    (headers: `x-wallet-address` lifts the rate limit, `x-user-token` + body `fundingTxId` for user-funded runs, `x-render-user` ties it to an account)
  - `GET /history?user=` — a user's past errands
  - `GET /errand/:id` — one errand, public (powers `/r/:id` share pages)
  - `POST /watch` / `GET /watches?user=` / `GET /watch/:id` / `DELETE /watch/:id` — recurring watches (owner-guarded delete)
  - `GET /publishers/verify?domain=` — live check of a domain's x402.json
  - `GET /publishers/leaderboard` — publishers actually tipped, from the ledger
  - `POST /auth/token` — create account or log in (`{username, login?}`)
  - `POST /auth/init` — initialize wallet on ARC-TESTNET (returns challengeId)
  - `POST /auth/fund` — start a PIN-approved USDC transfer of a task budget (returns challengeId + refId)
  - `GET /auth/fund/status?challengeId=` — poll the funding transfer until confirmed (resolved via the challenge's `correlationIds`; `refId=` kept as fallback)
  - `GET /auth/wallets` — list user's wallets (requires `x-user-token`)
  - `GET /auth/balance/:walletId` — get wallet token balances
  - `GET /auth/configured` — check if Circle Wallets SDK is configured

# render — backend

The engine behind **render**: an autonomous web-errand agent that pays a
fraction of a cent (in USDC, on Arc) for each page it opens, and returns the
answer plus a receipt of every fare.

Two services, fused from two ideas:

- **`render-service`** (the seller) — an x402-paywalled endpoint. Pay `$0.001`
  in USDC and it opens the page in a real browser (Playwright) and returns the
  human-visible text. This is real metered work: rendering costs compute, and
  normal HTTP-only agents can't do it.
- **`orchestrator`** (the buyer) — a Claude-powered agent that, given a goal and
  a budget, plans which pages are worth opening, pays the render-service per
  page, decides after each page whether it has enough, and synthesizes a final
  answer — all while staying inside the budget.

The agent's wallet → render-service payment is a **real settlement on Arc**.

```
  you ──(goal + budget)──►  orchestrator (Claude: plan → assess → synthesize)
                                  │  pays $0.001 USDC per page (x402, Arc)
                                  ▼
                            render-service (Playwright) ──► page text
                                  │
  you ◄──(answer + receipt)──◄────┘
```

## Layout

| File | What it is |
|---|---|
| `src/config.ts` | Arc/Circle constants + env loading |
| `src/lib/render.ts` | Playwright render + SSRF guard (the metered work) |
| `src/render-service.ts` | the seller: x402-gated `GET /render?url=` |
| `src/lib/pay.ts` | the agent's Gateway wallet (deposit + pay-per-render) |
| `src/brain.ts` | Claude: `plan()`, `assess()` (the spend decision), `synthesize()` |
| `src/runner.ts` | the task loop + live receipt |
| `src/orchestrator.ts` | HTTP API the frontend calls (`POST /task`, SSE) |
| `src/generate-wallets.ts` | creates the seller + agent wallets |

Brain: an OpenAI-compatible endpoint (**DeepSeek** `deepseek-chat` by default;
set `LLM_BASE_URL` / `MODEL_PLAN` / `MODEL_LOOP` to use another provider).

Arc Testnet: chain `eip155:5042002`, RPC `rpc.testnet.arc.network`, USDC
`0x3600…0000`, Gateway facilitator `gateway-api-testnet.circle.com`.

## Run it

```bash
npm install
npx playwright install chromium
npm run generate-wallets          # writes seller + agent keys to .env.local
```

Then:
1. Fund the **agent** wallet with Arc Testnet USDC at https://faucet.circle.com/
   (this pays for renders + gas).
2. Add `DEEPSEEK_API_KEY=...` to `.env.local` (the agent's brain).

```bash
npm run render-service            # seller  on :4000
npm run orchestrator              # buyer   on :4100
```

Run an errand (streams the receipt as it pays):

```bash
curl -N -X POST http://localhost:4100/task \
  -H 'content-type: application/json' \
  -d '{"goal":"Which of these has the lowest price?",
       "seedUrls":["https://example.com/a","https://example.com/b"],
       "budgetUsdc":0.02}'
```

## Endpoints

- `render-service` — `GET /health`, `GET /render?url=` (paywalled `$0.001`)
- `orchestrator` — `GET /health`, `GET /balance`, `POST /task` (SSE stream of
  `plan` → `open` → `paid` → `finding` → `stop` → `answer`)

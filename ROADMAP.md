# render — Roadmap to 10x

> **Status (July 2):** P0 #1 (user-funded errands), #2 (persistent ledger — Upstash),
> #3 (share permalinks), and #4 (publisher onboarding page + verify + leaderboard) are
> **shipped and verified in production**. Accounts, history, and watches also persist
> across redeploys. Remaining: demo video + submission (#5), traction outreach, and the
> P1 items below.

Cross-referenced against the **Lepton Agents Hackathon** judging criteria
(submission deadline **July 6, 2026, 11:59 PM ET** — 4 days out):

| Criterion | Weight | Where render stands today |
|---|---|---|
| **Agentic Sophistication** | 30% | Strong core: plan → assess → synthesize loop with a real per-page spend decision. Weakness: the agent only opens pages from its initial plan — it never discovers new URLs mid-task. |
| **Traction** | 30% | Weakest area. Stats are in-memory and reset on every deploy; there's no shareable artifact, no viral loop, no publisher onboarding. "Volume you can point to" doesn't survive a redeploy. |
| **Circle tool usage** | 20% | Gateway/x402 + Programmable Wallets are integrated — but user wallets are **decorative**: the agent's wallet pays for everything, even for signed-in users. |
| **Innovation** | 20% | `/.well-known/x402.json` publisher discovery is genuinely novel — an open, registration-free standard. It needs to be formalized and made adoptable to land. |

Judges score **the delta shipped during the event window** and read the repo
hands-on. Priorities below are ordered by (score impact × feasibility before
July 6).

---

## P0 — Before submission (July 2–5)

### 1. User wallets actually pay for tasks
**Why 10x:** Closes the biggest credibility gap. Right now sign-in gets you a
wallet that does nothing but display a balance. When a signed-in user runs an
errand, *their* USDC should fund it — that's real user→agent→service→publisher
money flow, hitting **Circle tools (20%)**, **Agency (30%)**, and **Traction**
("payments actually flowing in test USDC") simultaneously.

**How:** Before starting a task for a signed-in user, create a Circle
user-initiated transfer challenge (user PIN-approves once) moving the task
budget from their wallet to the agent's wallet. Agent runs the task as today;
unspent budget is refunded at task end. Show `funded by you: $0.02` in the
receipt stream.

**Acceptance criteria:**
- [ ] Signed-in user with ≥ budget USDC runs a task; their wallet balance visibly decreases by exactly the amount spent (budget − refund).
- [ ] The funding transfer appears on Arc testnet explorer, linked from the receipt.
- [ ] Unspent budget is refunded to the user's wallet within 60s of task end, with a `refunded` SSE event.
- [ ] User with insufficient balance gets a clear error + faucet link — task does not start.
- [ ] Anonymous users still work exactly as today (agent-funded, rate-limited).

### 2. Persistent traction ledger
**Why 10x:** Traction is 30% of the score and the submission form asks for
numbers in writing. In-memory stats that zero out on redeploy actively destroy
the evidence.

**How:** Persist `{errands, uniqueUsers, settledUsdc, tippedUsdc, taskLog}` to
a free external KV (Upstash Redis free tier) or a tiny SQLite file committed to
a Render persistent disk. Increment atomically; `/stats` reads from the store.
Backfill with an honest manual estimate of pre-persistence numbers, labeled as such.

**Acceptance criteria:**
- [ ] `/stats` numbers survive a backend redeploy (verify: redeploy, numbers unchanged).
- [ ] Every completed task appends a log row: timestamp, goal (truncated), pages, spent, tipped.
- [ ] Landing-page counter reflects the persistent numbers.
- [ ] A `/stats/history` endpoint (or simple export) can produce the traction numbers for the submission form.

### 3. Shareable errand permalinks
**Why 10x:** The viral loop. Every completed errand becomes a public artifact —
answer + citations + itemized on-chain receipt — that users can post. Each
share is a demo of the whole product and drives the traction number.

**How:** On task completion, store the result under a short id (same store as
#2). `GET /r/:id` on the frontend renders a read-only result page: goal, answer,
sources, fare-by-fare receipt with Arc explorer links, and a "run your own
errand" CTA. Add a "Share" button to the task console.

**Acceptance criteria:**
- [ ] Completing a task yields a share URL; opening it in an incognito window shows the full answer + receipt with working explorer links.
- [ ] Permalinks survive redeploys (persistent store).
- [ ] Share page has OG meta tags so the link unfurls with the goal + spend summary on X/Discord.
- [ ] CTA on the share page starts a new task on the main console.

### 4. Publisher onboarding — "Get paid by AI agents" page
**Why 10x:** The hackathon's emphasized RFB is **Creator & Publisher
Monetization**. render already pays publishers; nobody knows. A one-page
generator turns the tipping mechanism into an adoptable standard — and every
publisher who adds the file is a *real external user* for the traction section.

**How:** `/publishers` page on the frontend: paste your USDC wallet + site name
→ it generates the exact `/.well-known/x402.json` contents with copy button and
hosting instructions → a "verify" button fetches the URL live and confirms
discovery. Show a leaderboard of tipped publishers (from the persistent ledger).

**Acceptance criteria:**
- [ ] A site owner with zero crypto knowledge can generate a valid x402.json in under a minute.
- [ ] "Verify my site" fetches `https://{domain}/.well-known/x402.json` server-side and reports found/valid/invalid with a specific reason.
- [ ] Verified publishers appear in a public directory/leaderboard with total tips received.
- [ ] At least 2 real external sites (not owned by us) publish the file before the deadline — this is the traction proof.

### 5. Demo video + submission
**Why:** Hard requirement. Under 3 minutes, judges use it as the guided tour.

**Acceptance criteria:**
- [ ] ≤ 3 min video: problem (15s) → live errand with fares streaming (60s) → sign-in + user-funded task (30s) → publisher tip landing on-chain (30s) → traction numbers (15s).
- [ ] Uploaded to YouTube/Loom, linked in README.
- [ ] Submission form completed with traction numbers from the persistent ledger, before July 6, 11:59 PM ET.

---

## P1 — If time remains (July 5–6)

### 6. Mid-task link discovery (adaptive frontier)
**Why:** Directly targets **Agentic Sophistication (30%)**. Today the agent
executes a fixed plan; letting `assess()` propose follow-up URLs it found *on
the page* makes it genuinely exploratory — it decides where to go next based on
what it just paid to learn.

**How:** Add `suggested_urls: [{url, why}]` to the assess schema. Runner
maintains a priority frontier (planned + suggested), still hard-capped by
budget. Emit a `discovered` SSE event so viewers see the agent finding its own
path.

**Acceptance criteria:**
- [ ] Given a hub page (e.g. a category listing) and a goal requiring detail pages, the agent navigates to at least one URL that was NOT in the original plan.
- [ ] Budget ceiling still holds exactly — discovered pages never push spend past the cap.
- [ ] `discovered` events render in the live console ("found a lead → …").

### 7. render as a hireable agent (x402-paywalled task API)
**Why:** Hits RFB 2 (selling agent services) and RFB 3 (agent-to-agent
networks) with ~50 lines: other agents pay render in USDC to run errands.
render becomes both a buyer *and* a seller in the nanopayment economy.

**How:** `POST /hire` — same body as `/task`, but paywalled with the existing
x402 gateway middleware (price = budget + 20% service fee). Returns JSON
(not SSE) for machine consumption. Document it in the README as "hire render
from your own agent."

**Acceptance criteria:**
- [ ] `curl` without payment gets a 402 with correct x402 payment-required headers.
- [ ] A paying client (script using the same AgentWallet lib) gets the full answer JSON back.
- [ ] The service fee visibly lands in the agent's wallet on Arc explorer.
- [ ] README documents the endpoint with a copy-paste client example.

### 8. Watch-mode alerts (webhook)
**Why:** Watch mode exists but changes are only visible by polling. A webhook
makes it an actual monitoring product ("tell me when the price drops").

**Acceptance criteria:**
- [ ] `POST /watch` accepts an optional `webhookUrl`; on `changed=true` it POSTs `{goal, lastAnswer, currentAnswer}`.
- [ ] Delivery failures are logged and retried once; they never crash the watch cycle.

---

## P2 — Post-hackathon (judges reward continuation commitment)

- **Real persistence** — Postgres for users/tasks/watches; username→userId mapping survives deploys (today it's an in-memory Map, so returning users break on every redeploy — worth calling out as a known limitation in the video if not fixed).
- **Streaming payments** (RFB 4) — pay-per-second rendering sessions for long scrapes via Gateway streaming.
- **Publisher analytics dashboard** — publishers sign in with Circle wallets, see per-page tip revenue over time.
- **x402.json spec write-up** — publish the discovery convention as a small standard others can implement; PR it to the x402 ecosystem docs.
- **Multi-agent marketplace** — render hires specialist agents (PDF reader, translator) via x402, composing the fee chain.
- **Mainnet** — real USDC, real publisher payouts.

---

## Explicitly not doing (and why)

- **Mobile app / browser extension** — no score impact per criterion, large time cost.
- **More LLM providers** — DeepSeek works; swapping brains adds zero judged value.
- **Token/points systems** — the product's whole thesis is honest per-action USDC pricing.
- **Fully custom smart contracts** — Circle Contracts integration would be nice for the 20% tools score, but Gateway + Wallets + x402 already demonstrate three Circle products; contract work doesn't fit in 4 days without risking the P0s.

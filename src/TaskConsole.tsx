import { useEffect, useRef, useState } from "react";

/**
 * The live task console — the interactive heart of the demo.
 * A visitor gives the agent a goal + a budget, and watches it plan, open pages,
 * pay a real fare per page (x402 on Arc), and return an answer + receipt — all
 * streamed live over SSE from the orchestrator.
 */

const ORCH = (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? "http://localhost:4100";

// --- event shapes, mirroring backend/src/runner.ts ---
type ReceiptRow = { url: string; title: string; paidUsdc: number; settlementId?: string };
type TaskEvent =
  | { type: "plan"; reasoning: string; extractionGoal: string; urls: { url: string; why: string }[] }
  | { type: "open"; url: string }
  | { type: "paid"; url: string; title: string; paidUsdc: number; settlementId?: string; spentUsdc: number }
  | { type: "finding"; url: string; finding: string; relevant: boolean; infoGain?: number; confidence?: number }
  | { type: "tipped"; url: string; publisher: string; publisherWallet: string; tipUsdc: number; settlementId?: string }
  | { type: "render_error"; url: string; error: string }
  | { type: "stop"; reason: string }
  | { type: "answer"; answer: string; confidence: string; sources?: { url: string; claim: string }[]; data?: Record<string, unknown> | null; spentUsdc: number; returnedUsdc: number; receipt: ReceiptRow[]; verifyUrl?: string }
  | { type: "error"; error: string };

const EXAMPLES: { label: string; goal: string; seeds: string[]; budget: number }[] = [
  {
    label: "Cheapest laptop",
    goal: "Which laptop on this page is the cheapest, and what is its exact price?",
    seeds: ["https://webscraper.io/test-sites/e-commerce/ajax/computers/laptops"],
    budget: 0.01,
  },
  {
    label: "Compare two phones",
    goal: "Compare the prices of phones on these two pages — which page has the better deal?",
    seeds: [
      "https://webscraper.io/test-sites/e-commerce/ajax/computers/phones",
      "https://webscraper.io/test-sites/e-commerce/ajax/computers/tablets",
    ],
    budget: 0.02,
  },
];

const BUDGETS = [0.01, 0.02, 0.05];
const WATCH_INTERVALS = [15, 30, 60];

interface WatchInfo {
  id: string;
  goal: string;
  status: string;
  changed: boolean;
  currentAnswer: string | null;
  runs: number;
  totalSpentUsdc: number;
  intervalMin: number;
  nextRunAt: number | null;
}

function host(u: string): string {
  try {
    return new URL(u).host + new URL(u).pathname.replace(/\/$/, "");
  } catch {
    return u;
  }
}

/** Shorten a Circle settlement reference for display (e.g. 149f55c5…796c8). */
function shortRef(id?: string): string | null {
  if (!id) return null;
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
}

/** Parse the orchestrator's POST + SSE stream (EventSource is GET-only, so we read the body ourselves). */
async function streamTask(
  body: { goal: string; seedUrls: string[]; budgetUsdc: number },
  handlers: { onEvent: (e: TaskEvent) => void; onDone: () => void; onError: (m: string) => void },
  signal: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch(`${ORCH}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    handlers.onError(`Couldn't reach the agent at ${ORCH}. Is the orchestrator running? (${(e as Error).message})`);
    return;
  }
  if (!res.ok || !res.body) {
    handlers.onError(`Agent returned ${res.status}.`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let evName = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) data += line.slice(5).trim();
          else if (line.startsWith("event:")) evName = line.slice(6).trim();
        }
        if (evName === "end") {
          handlers.onDone();
          return;
        }
        if (data) {
          try {
            handlers.onEvent(JSON.parse(data) as TaskEvent);
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    }
    handlers.onDone();
  } catch (e) {
    if ((e as Error).name !== "AbortError") handlers.onError((e as Error).message);
  }
}

export default function TaskConsole() {
  const [goal, setGoal] = useState("");
  const [seeds, setSeeds] = useState("");
  const [budget, setBudget] = useState(0.02);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [watchMode, setWatchMode] = useState(false);
  const [watchInterval, setWatchInterval] = useState(30);
  const [activeWatches, setActiveWatches] = useState<WatchInfo[]>([]);

  const getMyWatchIds = (): string[] => {
    try { return JSON.parse(localStorage.getItem("render_watches") ?? "[]"); } catch { return []; }
  };
  const saveWatchId = (id: string) => {
    const ids = getMyWatchIds();
    if (!ids.includes(id)) localStorage.setItem("render_watches", JSON.stringify([...ids, id]));
  };
  const removeWatchId = (id: string) => {
    localStorage.setItem("render_watches", JSON.stringify(getMyWatchIds().filter((x) => x !== id)));
  };

  useEffect(() => {
    let live = true;
    const load = () => {
      const myIds = getMyWatchIds();
      if (!myIds.length) { setActiveWatches([]); return; }
      Promise.all(myIds.map((id) =>
        fetch(`${ORCH}/watch/${id}`).then((r) => r.ok ? r.json() : null).catch(() => null)
      )).then((results) => {
        if (!live) return;
        const valid = results.filter((w): w is WatchInfo => w !== null);
        const gone = myIds.filter((id) => !valid.some((w) => w.id === id));
        gone.forEach(removeWatchId);
        setActiveWatches(valid);
      });
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const plan = events.find((e) => e.type === "plan") as Extract<TaskEvent, { type: "plan" }> | undefined;
  const answer = events.find((e) => e.type === "answer") as Extract<TaskEvent, { type: "answer" }> | undefined;
  const spent =
    answer?.spentUsdc ??
    [...events].reverse().find((e): e is Extract<TaskEvent, { type: "paid" }> => e.type === "paid")?.spentUsdc ??
    0;
  const spentPct = Math.min(100, (spent / budget) * 100);

  function loadExample(ex: (typeof EXAMPLES)[number]) {
    setGoal(ex.goal);
    setSeeds(ex.seeds.join("\n"));
    setBudget(ex.budget);
    setEvents([]);
    setError(null);
  }

  function run() {
    if (!goal.trim() || running) return;
    setEvents([]);
    setError(null);
    const seedUrls = seeds
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (watchMode) {
      setRunning(true);
      fetch(`${ORCH}/watch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), seedUrls, budgetUsdc: budget, intervalMin: watchInterval }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) setError(d.error);
          else {
            if (d.id) saveWatchId(d.id);
            setEvents([{
              type: "answer",
              answer: d.currentAnswer ?? "Watch started — first result incoming.",
              confidence: "medium",
              spentUsdc: 0,
              returnedUsdc: budget,
              receipt: [],
            }]);
            const myIds = getMyWatchIds();
            Promise.all(myIds.map((id) =>
              fetch(`${ORCH}/watch/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)
            )).then((results) => setActiveWatches(results.filter((w): w is WatchInfo => w !== null))).catch(() => {});
          }
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setRunning(false));
      return;
    }

    setRunning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamTask(
      { goal: goal.trim(), seedUrls, budgetUsdc: budget },
      {
        onEvent: (e) => setEvents((prev) => [...prev, e]),
        onDone: () => setRunning(false),
        onError: (m) => {
          setError(m);
          setRunning(false);
        },
      },
      ctrl.signal,
    );
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const started = events.length > 0 || running;

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", textAlign: "left" }}>
      {/* ---------- input ---------- */}
      <div className="card" style={{ padding: 26 }}>
        <label className="eyebrow" style={{ display: "block", marginBottom: 12 }}>
          The errand
        </label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Which of these has the lowest price?"
          rows={2}
          className="tc-input"
          style={{ fontSize: 18, fontFamily: "var(--font-body)", marginBottom: 18 }}
        />

        <label className="eyebrow" style={{ display: "block", marginBottom: 10 }}>
          Pages to work from <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--text-3)" }}>— one per line, optional</span>
        </label>
        <textarea
          value={seeds}
          onChange={(e) => setSeeds(e.target.value)}
          placeholder="https://…&#10;https://…"
          rows={3}
          className="tc-input num"
          style={{ fontSize: 13, marginBottom: 20 }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="eyebrow">The leash</span>
            <div style={{ display: "flex", gap: 6 }}>
              {BUDGETS.map((b) => (
                <button
                  key={b}
                  onClick={() => setBudget(b)}
                  className="num"
                  style={{
                    cursor: "pointer", padding: "7px 13px", borderRadius: 999, fontSize: 12.5,
                    border: "1px solid " + (budget === b ? "var(--accent-border)" : "var(--border-strong)"),
                    background: budget === b ? "var(--accent-dim)" : "transparent",
                    color: budget === b ? "var(--accent)" : "var(--text-2)",
                  }}
                >
                  ${b.toFixed(2)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setWatchMode(!watchMode)}
              className="num"
              style={{
                cursor: "pointer", padding: "7px 13px", borderRadius: 999, fontSize: 12.5,
                border: "1px solid " + (watchMode ? "var(--accent-border)" : "var(--border-strong)"),
                background: watchMode ? "var(--accent-dim)" : "transparent",
                color: watchMode ? "var(--accent)" : "var(--text-2)",
              }}
            >
              {watchMode ? "⟳ Watch on" : "⟳ Watch"}
            </button>
            {watchMode && (
              <div style={{ display: "flex", gap: 4 }}>
                {WATCH_INTERVALS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setWatchInterval(m)}
                    className="num"
                    style={{
                      cursor: "pointer", padding: "5px 9px", borderRadius: 999, fontSize: 11,
                      border: "1px solid " + (watchInterval === m ? "var(--accent-border)" : "var(--border)"),
                      background: watchInterval === m ? "var(--accent-dim)" : "transparent",
                      color: watchInterval === m ? "var(--accent)" : "var(--text-3)",
                    }}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            )}
          </div>
          <span style={{ flex: 1 }} />
          {running ? (
            <button className="btn btn-ghost" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={run} disabled={!goal.trim()} style={!goal.trim() ? { opacity: 0.5, cursor: "default" } : undefined}>
              {watchMode ? "Start watching" : "Run the errand"}
            </button>
          )}
        </div>

        {!started && (
          <div style={{ marginTop: 22, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="eyebrow" style={{ marginRight: 4 }}>Try</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.label} onClick={() => loadExample(ex)} className="tc-chip">
                {ex.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---------- spend meter (the leash, filling) ---------- */}
      {started && (
        <div style={{ margin: "22px 2px 8px", display: "flex", alignItems: "center", gap: 14 }}>
          <span className="num" style={{ fontSize: 12, color: "var(--text-3)", minWidth: 96 }}>
            spent ${spent.toFixed(3)}
          </span>
          <div style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
            <div style={{ width: `${spentPct}%`, height: "100%", background: "var(--accent)", transition: "width .4s ease" }} />
          </div>
          <span className="num" style={{ fontSize: 12, color: "var(--text-3)", minWidth: 78, textAlign: "right" }}>
            of ${budget.toFixed(2)}
          </span>
        </div>
      )}

      {/* ---------- live stream ---------- */}
      {error && (
        <div className="card" style={{ padding: 20, marginTop: 18, borderColor: "var(--accent-border)" }}>
          <div className="eyebrow" style={{ color: "var(--accent)", marginBottom: 8 }}>Couldn't run</div>
          <div style={{ fontSize: 14.5, color: "var(--text-2)" }}>{error}</div>
        </div>
      )}

      {plan && (
        <div style={{ marginTop: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>The plan</div>
          <p style={{ margin: "0 0 14px", fontSize: 15, color: "var(--text-2)" }}>{plan.reasoning}</p>
        </div>
      )}

      {started && (
        <div style={{ display: "grid", gap: 2, marginTop: 6 }}>
          {events.map((e, i) => (
            <EventRow key={i} e={e} />
          ))}
          {running && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 2px", color: "var(--text-3)" }}>
              <span className="tc-dot" />
              <span className="num" style={{ fontSize: 13 }}>working…</span>
            </div>
          )}
        </div>
      )}

      {/* ---------- final answer ---------- */}
      {answer && (
        <div className="card" style={{ padding: 28, marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <span className="eyebrow">The answer</span>
            <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>confidence · {answer.confidence}</span>
          </div>
          <p className="serif" style={{ margin: "0 0 22px", fontSize: 24, lineHeight: 1.3, color: "var(--text-1)" }}>
            {answer.answer}
          </p>
          {answer.sources && answer.sources.length > 0 && (
            <div style={{ marginBottom: 18, padding: "12px 14px", background: "var(--bg-2)", borderRadius: 8 }}>
              <span className="eyebrow" style={{ fontSize: 10, marginBottom: 8, display: "block" }}>Sources</span>
              {answer.sources.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
                  <a className="num tc-link" href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, flexShrink: 0 }}>
                    {host(s.url)}
                  </a>
                  <span style={{ fontSize: 13, color: "var(--text-2)" }}>{s.claim}</span>
                </div>
              ))}
            </div>
          )}
          {answer.data && Object.keys(answer.data).length > 0 && (
            <div style={{ marginBottom: 18, padding: "12px 14px", background: "var(--bg-2)", borderRadius: 8, fontFamily: "var(--font-num)" }}>
              <span className="eyebrow" style={{ fontSize: 10, marginBottom: 8, display: "block" }}>Structured data</span>
              <pre style={{ margin: 0, fontSize: 12.5, color: "var(--text-1)", whiteSpace: "pre-wrap" }}>
                {JSON.stringify(answer.data, null, 2)}
              </pre>
            </div>
          )}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "grid", gap: 9 }}>
            {answer.receipt.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span className="coin" />
                <span className="num" style={{ fontSize: 12.5, color: "var(--text-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {host(r.url)}
                </span>
                <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>${r.paidUsdc.toFixed(3)}</span>
                {shortRef(r.settlementId) ? (
                  <span className="num" style={{ fontSize: 11, color: "var(--accent)" }} title={`Circle Gateway settlement ${r.settlementId}`}>
                    {shortRef(r.settlementId)}
                  </span>
                ) : (
                  <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>settled</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>
              {answer.receipt.length} page{answer.receipt.length === 1 ? "" : "s"} · spent ${answer.spentUsdc.toFixed(3)} · ${answer.returnedUsdc.toFixed(3)} returned
            </span>
            {answer.verifyUrl && (
              <a className="num tc-link" href={answer.verifyUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                Verify on Arc ↗
              </a>
            )}
          </div>
          <div className="num" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 10, lineHeight: 1.5 }}>
            Each fare is a Circle Gateway settlement on Arc, paid from the agent's own USDC.
            Fares batch on-chain — “Verify on Arc” opens the agent wallet, where its USDC and
            its deposit into Circle's Gateway contract are public transactions.
          </div>
        </div>
      )}

      {/* ---------- active watches ---------- */}
      {activeWatches.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Active watches</div>
          <div style={{ display: "grid", gap: 10 }}>
            {activeWatches.map((w) => (
              <div key={w.id} className="card" style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontSize: 16, color: "var(--text-1)" }}>
                    "{w.goal.length > 60 ? w.goal.slice(0, 57) + "…" : w.goal}"
                  </span>
                  <span className="num" style={{ fontSize: 11, color: w.changed ? "var(--accent)" : "var(--text-3)" }}>
                    {w.changed ? "changed!" : w.status}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>every {w.intervalMin}m</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>{w.runs} run{w.runs === 1 ? "" : "s"}</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>${w.totalSpentUsdc.toFixed(3)} spent</span>
                  {w.nextRunAt && (
                    <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>
                      next in {Math.max(0, Math.round((w.nextRunAt - Date.now()) / 60000))}m
                    </span>
                  )}
                </div>
                {w.currentAnswer && (
                  <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--text-2)", lineHeight: 1.4 }}>
                    {w.currentAnswer.length > 200 ? w.currentAnswer.slice(0, 197) + "…" : w.currentAnswer}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: TaskEvent }) {
  if (e.type === "open")
    return (
      <Row tone="muted">
        <span className="num">opening</span> <span className="num tc-url">{host(e.url)}</span>
      </Row>
    );
  if (e.type === "paid")
    return (
      <Row>
        <span className="coin" />
        <span className="num tc-url" style={{ flex: 1 }}>{host(e.url)}</span>
        <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>paid ${e.paidUsdc.toFixed(3)}</span>
        {shortRef(e.settlementId) && (
          <span className="num" style={{ fontSize: 11, color: "var(--accent)" }} title={`Circle Gateway settlement ${e.settlementId}`}>
            {shortRef(e.settlementId)}
          </span>
        )}
      </Row>
    );
  if (e.type === "tipped")
    return (
      <Row>
        <span style={{ fontSize: 11, color: "var(--accent)" }}>tip</span>
        <span className="num" style={{ fontSize: 12.5, color: "var(--text-2)", flex: 1 }}>
          → {e.publisher}
        </span>
        <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>${e.tipUsdc.toFixed(3)}</span>
        {shortRef(e.settlementId) && (
          <span className="num" style={{ fontSize: 11, color: "var(--accent)" }} title={`Publisher tip settlement ${e.settlementId}`}>
            {shortRef(e.settlementId)}
          </span>
        )}
      </Row>
    );
  if (e.type === "finding")
    return (
      <Row tone={e.relevant ? "default" : "muted"}>
        <span style={{ color: e.relevant ? "var(--accent)" : "var(--text-3)" }}>{e.relevant ? "found" : "—"}</span>{" "}
        <span style={{ fontFamily: "var(--font-body)", fontSize: 14, flex: 1 }}>{e.finding}</span>
        {e.confidence != null && (
          <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }} title={`info gain: ${((e.infoGain ?? 0) * 100).toFixed(0)}% · confidence: ${(e.confidence * 100).toFixed(0)}%`}>
            {(e.confidence * 100).toFixed(0)}% sure
          </span>
        )}
      </Row>
    );
  if (e.type === "render_error") {
    const botBlocked = e.error.includes("bot-blocked");
    return (
      <Row tone={botBlocked ? "accent" : "muted"}>
        <span className="num tc-url">{host(e.url)}</span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, flex: 1 }}>
          {botBlocked ? "blocked by bot protection — skipped" : "couldn't open — skipped"}
        </span>
      </Row>
    );
  }
  if (e.type === "stop")
    return (
      <Row tone="muted">
        <span style={{ height: 1, width: 22, background: "var(--border-strong)", display: "inline-block" }} /> <span className="num">{e.reason}</span>
      </Row>
    );
  if (e.type === "error")
    return <Row tone="accent">{e.error}</Row>;
  return null;
}

function Row({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "muted" | "accent" }) {
  const color = tone === "muted" ? "var(--text-3)" : tone === "accent" ? "var(--accent)" : "var(--text-2)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 2px", borderBottom: "1px solid var(--border)", fontSize: 13, color }}>
      {children}
    </div>
  );
}

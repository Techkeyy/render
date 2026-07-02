import { useEffect, useState } from "react";

/**
 * Public, read-only view of one completed errand — the share permalink.
 * Lives at /r/:id. Everything shown is already public on-chain; the owner's
 * username is never included.
 */

const ORCH = (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? "http://localhost:4100";

interface Errand {
  id: string;
  goal: string;
  answer: string | null;
  confidence: string | null;
  spentUsdc: number;
  tippedUsdc: number;
  funded: boolean;
  receipt: { url: string; title: string; paidUsdc: number; settlementId?: string }[];
  sources?: { url: string; claim: string }[];
  createdAt: number;
}

function host(u: string): string {
  try {
    return new URL(u).host + new URL(u).pathname.replace(/\/$/, "");
  } catch {
    return u;
  }
}

function shortRef(id?: string): string | null {
  if (!id) return null;
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
}

export default function SharePage({ id }: { id: string }) {
  const [errand, setErrand] = useState<Errand | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound" | "error">("loading");

  useEffect(() => {
    let live = true;
    // The free-tier backend cold-starts in ~50s; retry until it wakes.
    const load = (attempt: number) =>
      fetch(`${ORCH}/errand/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12000) })
        .then((r) => {
          if (!live) return;
          if (r.status === 404) { setState("notfound"); return; }
          if (!r.ok) throw new Error(String(r.status));
          return r.json().then((d) => { setErrand(d); setState("ok"); });
        })
        .catch(() => {
          if (!live) return;
          if (attempt < 12) setTimeout(() => load(attempt + 1), 6000);
          else setState("error");
        });
    load(0);
    return () => { live = false; };
  }, [id]);

  return (
    <div style={{ minHeight: "100vh", padding: "40px 20px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <a href="/" style={{ textDecoration: "none" }}>
          <span style={{ fontFamily: "var(--font-serif)", fontSize: 24, color: "var(--text-1)" }}>render</span>
        </a>
        <div className="eyebrow" style={{ margin: "26px 0 10px" }}>A completed errand</div>

        {state === "loading" && (
          <div className="card" style={{ padding: 26, display: "flex", alignItems: "center", gap: 10 }}>
            <span className="tc-dot" />
            <span className="num" style={{ fontSize: 13, color: "var(--text-3)" }}>
              Fetching the receipt… (the agent may be waking up — ~30s)
            </span>
          </div>
        )}
        {state === "notfound" && (
          <div className="card" style={{ padding: 26 }}>
            <p style={{ margin: 0, fontSize: 15, color: "var(--text-2)" }}>
              This errand doesn't exist (or its record has expired).
            </p>
          </div>
        )}
        {state === "error" && (
          <div className="card" style={{ padding: 26 }}>
            <p style={{ margin: 0, fontSize: 15, color: "var(--text-2)" }}>
              Couldn't reach the agent. Refresh to try again.
            </p>
          </div>
        )}

        {errand && (
          <div className="card" style={{ padding: 28 }}>
            <p className="serif" style={{ margin: "0 0 6px", fontSize: 21, lineHeight: 1.3, color: "var(--text-1)" }}>
              “{errand.goal}”
            </p>
            <div className="num" style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 18 }}>
              {new Date(errand.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              {errand.funded ? " · funded by the requester's own wallet" : ""}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <span className="eyebrow">The answer</span>
              {errand.confidence && (
                <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>confidence · {errand.confidence}</span>
              )}
            </div>
            <p style={{ margin: "0 0 20px", fontSize: 16.5, lineHeight: 1.5, color: "var(--text-1)" }}>
              {errand.answer ?? "The agent came back without an answer this time."}
            </p>

            {(errand.sources?.length ?? 0) > 0 && (
              <div style={{ marginBottom: 18, padding: "12px 14px", background: "var(--bg-2)", borderRadius: 8 }}>
                <span className="eyebrow" style={{ fontSize: 10, marginBottom: 8, display: "block" }}>Sources</span>
                {errand.sources!.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
                    <a className="num tc-link" href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, flexShrink: 0 }}>
                      {host(s.url)}
                    </a>
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}>{s.claim}</span>
                  </div>
                ))}
              </div>
            )}

            {errand.receipt.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "grid", gap: 9 }}>
                <span className="eyebrow" style={{ fontSize: 10 }}>The receipt — real USDC settlements on Arc</span>
                {errand.receipt.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <span className="coin" />
                    <span className="num" style={{ fontSize: 12.5, color: "var(--text-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.title.startsWith("tip →") ? r.title : host(r.url)}
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
            )}

            <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>
                {errand.receipt.length} settlement{errand.receipt.length === 1 ? "" : "s"} · spent ${errand.spentUsdc.toFixed(3)}
                {errand.tippedUsdc > 0 ? ` · $${errand.tippedUsdc.toFixed(3)} tipped to publishers` : ""}
              </span>
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 26 }}>
          <p style={{ fontSize: 14.5, color: "var(--text-2)", marginBottom: 14 }}>
            An AI agent ran this errand — opened the pages, paid a fraction of a cent per page, and came back with the answer.
          </p>
          <a href="/" className="btn btn-primary" style={{ textDecoration: "none" }}>
            Run your own errand
          </a>
        </div>
      </div>
    </div>
  );
}

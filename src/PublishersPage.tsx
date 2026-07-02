import { useEffect, useState } from "react";

/**
 * Publisher onboarding — "get paid when AI agents read your site."
 * One hosted file opts a site into tips: /.well-known/x402.json with a USDC
 * wallet. This page generates the file, verifies it's live, and shows who's
 * already earning.
 */

const ORCH = (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? "http://localhost:4100";

interface LeaderboardRow {
  publisher: string;
  tips: number;
  totalUsdc: number;
}

export default function PublishersPage() {
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [copied, setCopied] = useState(false);
  const [domain, setDomain] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<{ found: boolean; name?: string; wallet?: string; reason?: string } | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    fetch(`${ORCH}/publishers/leaderboard`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setBoard)
      .catch(() => {});
  }, []);

  const walletOk = /^0x[0-9a-fA-F]{40}$/.test(wallet.trim());
  const fileJson = JSON.stringify(
    { name: name.trim() || "Your Site", wallet: walletOk ? wallet.trim() : "0xYourUsdcWalletOnArc…" },
    null,
    2,
  );

  function copyFile() {
    navigator.clipboard.writeText(fileJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  }

  function downloadFile() {
    const blob = new Blob([fileJson + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "x402.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function verify() {
    if (!domain.trim() || verifying) return;
    setVerifying(true);
    setVerdict(null);
    fetch(`${ORCH}/publishers/verify?domain=${encodeURIComponent(domain.trim())}`)
      .then((r) => r.json())
      .then(setVerdict)
      .catch(() => setVerdict({ found: false, reason: "Couldn't reach the agent — try again in a moment." }))
      .finally(() => setVerifying(false));
  }

  return (
    <div style={{ minHeight: "100vh", padding: "40px 20px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <a href="/" style={{ textDecoration: "none" }}>
          <span style={{ fontFamily: "var(--font-serif)", fontSize: 24, color: "var(--text-1)" }}>render</span>
        </a>

        <div className="eyebrow" style={{ margin: "30px 0 10px" }}>For publishers</div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 34, lineHeight: 1.2, color: "var(--text-1)", margin: "0 0 14px", fontWeight: 500 }}>
          AI agents read your site.<br />Make them pay for it.
        </h1>
        <p style={{ fontSize: 16, color: "var(--text-2)", lineHeight: 1.55, margin: "0 0 30px", maxWidth: 560 }}>
          Every time render's agent reads a page on your domain, it sends your wallet a USDC tip —
          settled on Arc, per read, no subscription, no middleman, no registration. You opt in by
          hosting <span className="num" style={{ fontSize: 14 }}>one file</span> on your site. That's the whole integration.
        </p>

        {/* ---------- step 1: generate ---------- */}
        <div className="card" style={{ padding: 26, marginBottom: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>1 · Generate your file</div>
          <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Site name (e.g. My Blog)"
              className="tc-input"
              style={{ fontSize: 14.5 }}
            />
            <input
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="Your USDC wallet address on Arc (0x…)"
              className="tc-input num"
              style={{ fontSize: 13 }}
            />
          </div>
          {wallet.trim() && !walletOk && (
            <div style={{ fontSize: 12.5, color: "var(--accent)", marginBottom: 10 }}>
              That's not a valid 0x… address (40 hex characters). Any EVM wallet works — the tips arrive as USDC on Arc.
            </div>
          )}
          <div style={{ padding: "14px 16px", background: "var(--bg-2)", borderRadius: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
              <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>x402.json</span>
              <span style={{ display: "flex", gap: 14 }}>
                <button
                  onClick={downloadFile}
                  className="num tc-link"
                  style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  Download file
                </button>
                <button
                  onClick={copyFile}
                  className="num tc-link"
                  style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </span>
            </div>
            <pre className="num" style={{ margin: 0, fontSize: 12.5, color: "var(--text-1)", whiteSpace: "pre-wrap" }}>{fileJson}</pre>
          </div>
          <div className="eyebrow" style={{ margin: "18px 0 12px" }}>How to put it on your site</div>
          <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 10, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55 }}>
            <li>
              <strong>Download the file</strong> (button above). You'll have a small file called{" "}
              <span className="num" style={{ fontSize: 12 }}>x402.json</span> in your Downloads.
            </li>
            <li>
              <strong>Add it to your website</strong> so it ends up at{" "}
              <span className="num" style={{ fontSize: 12 }}>/.well-known/x402.json</span>. Where exactly depends on how your site is built:
              <div style={{ display: "grid", gap: 6, marginTop: 8, fontSize: 13, color: "var(--text-3)" }}>
                <div>
                  · <strong style={{ color: "var(--text-2)" }}>Vercel / Netlify / Next.js / Vite:</strong> in your project's code, make a folder
                  called <span className="num" style={{ fontSize: 12 }}>.well-known</span> inside the{" "}
                  <span className="num" style={{ fontSize: 12 }}>public</span> folder, drop the file in, deploy as usual.
                </div>
                <div>
                  · <strong style={{ color: "var(--text-2)" }}>GitHub Pages:</strong> same folder + file in your site repo, plus an empty file
                  named <span className="num" style={{ fontSize: 12 }}>.nojekyll</span> at the top level (without it GitHub hides dot-folders).
                </div>
                <div>
                  · <strong style={{ color: "var(--text-2)" }}>WordPress / cPanel hosting:</strong> open your host's File Manager, go to your
                  site's top folder (usually <span className="num" style={{ fontSize: 12 }}>public_html</span>), create the{" "}
                  <span className="num" style={{ fontSize: 12 }}>.well-known</span> folder if needed, upload the file into it.
                </div>
              </div>
            </li>
            <li>
              <strong>Check it's up:</strong> open{" "}
              <span className="num" style={{ fontSize: 12 }}>https://YOUR-DOMAIN/.well-known/x402.json</span> in your browser. If you can
              see the file, you're done.
            </li>
            <li>
              <strong>Verify below</strong> — type your domain in step 2 and hit Verify. Green check = agents can now pay you.
            </li>
          </ol>
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: "12px 0 0", lineHeight: 1.5 }}>
            Not the technical person? Download the file and send it to whoever manages your website with one line:
            “please host this at /.well-known/x402.json”. They'll know what to do.
          </p>
        </div>

        {/* ---------- step 2: verify ---------- */}
        <div className="card" style={{ padding: 26, marginBottom: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>2 · Verify it's live</div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="yoursite.com"
              className="tc-input num"
              style={{ fontSize: 13.5, flex: 1 }}
            />
            <button className="btn btn-primary" onClick={verify} disabled={!domain.trim() || verifying}
              style={!domain.trim() || verifying ? { opacity: 0.5 } : undefined}>
              {verifying ? "Checking…" : "Verify"}
            </button>
          </div>
          {verdict && (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "var(--bg-2)" }}>
              {verdict.found ? (
                <span style={{ fontSize: 14, color: "var(--text-1)" }}>
                  ✓ Found it. <strong>{verdict.name}</strong> is set up — tips will flow to{" "}
                  <span className="num" style={{ fontSize: 12 }}>{verdict.wallet?.slice(0, 8)}…{verdict.wallet?.slice(-6)}</span>{" "}
                  whenever the agent reads your pages.
                </span>
              ) : (
                <span style={{ fontSize: 14, color: "var(--text-2)" }}>✗ {verdict.reason}</span>
              )}
            </div>
          )}
        </div>

        {/* ---------- leaderboard ---------- */}
        <div className="card" style={{ padding: 26, marginBottom: 30 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Publishers earning from agents</div>
          {board.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>
              No tips recorded yet in the current ledger — yours could be the first name here.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 9 }}>
              {board.map((row, i) => (
                <div key={row.publisher} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="num" style={{ fontSize: 12, color: "var(--text-3)", width: 18 }}>{i + 1}</span>
                  <span style={{ fontSize: 14.5, color: "var(--text-1)", flex: 1 }}>{row.publisher}</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>
                    {row.tips} tip{row.tips === 1 ? "" : "s"}
                  </span>
                  <span className="num" style={{ fontSize: 12.5, color: "var(--accent)" }}>${row.totalUsdc.toFixed(3)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <a href="/" className="num tc-link" style={{ fontSize: 13 }}>← back to render</a>
        </div>
      </div>
    </div>
  );
}

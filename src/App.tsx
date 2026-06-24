import { useEffect, useState } from "react";
import TaskConsole from "./TaskConsole.tsx";

const ORCH = (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? "http://localhost:4100";

const scrollTo = (id: string) => () =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

const maxw = 1100;

function Coin() {
  return <span className="coin" aria-hidden />;
}

function AgentBalance() {
  const [usdc, setUsdc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`${ORCH}/balance`)
        .then((r) => r.json())
        .then((d) => { if (live) setUsdc(d.gatewayAvailableUsdc ?? null); })
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  if (!usdc) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <Coin />
      <span className="num" style={{ fontSize: 12.5, color: "var(--text-2)" }}>
        <span style={{ color: "var(--accent)" }}>{usdc}</span> USDC
      </span>
    </div>
  );
}

function LiveStats() {
  const [s, setS] = useState<{ errands: number; users: number; settledUsdc: number; tippedUsdc: number } | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`${ORCH}/stats`)
        .then((r) => r.json())
        .then((d) => { if (live) setS(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, 20_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  if (!s || s.errands === 0) return null;

  const total = (s.settledUsdc + s.tippedUsdc).toFixed(4);
  const items = [
    { value: String(s.errands), label: "errands run" },
    { value: String(s.users), label: s.users === 1 ? "user" : "users" },
    { value: `$${total}`, label: "USDC settled" },
  ];
  if (s.tippedUsdc > 0) items.push({ value: `$${s.tippedUsdc.toFixed(4)}`, label: "to publishers" });

  return (
    <div style={{ padding: "32px 32px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
      <div style={{ maxWidth: maxw, margin: "0 auto", display: "flex", justifyContent: "center", gap: 40, flexWrap: "wrap" }}>
        {items.map((it) => (
          <div key={it.label} style={{ textAlign: "center" }}>
            <div className="num" style={{ fontSize: 28, color: "var(--accent)", fontWeight: 600 }}>{it.value}</div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- illustrative receipt rows (a sample task, clearly labelled — not live data) ---
const sampleRows = [
  { site: "webscraper.io/…/laptops", paid: "0.001", note: "Lenovo $321.94" },
  { site: "webscraper.io/…/phones", paid: "0.001", note: "Nokia $109.99" },
  { site: "webscraper.io/…/tablets", paid: "0.001", note: "Lenovo $69.99", best: true },
];

function ReceiptCard() {
  return (
    <div className="card" style={{ padding: 22, fontFamily: "var(--font-num)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <span className="eyebrow">A sample errand</span>
        <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>budget · $0.02</span>
      </div>
      <div style={{ fontFamily: "var(--font-body)", color: "var(--text-1)", fontSize: 15, marginBottom: 18 }}>
        “Which of these devices is the cheapest?”
      </div>
      <div style={{ display: "grid", gap: 11 }}>
        {sampleRows.map((r) => (
          <div key={r.site} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Coin />
            <span className="num" style={{ fontSize: 13, color: "var(--text-2)", minWidth: 138 }}>{r.site}</span>
            <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>paid ${r.paid}</span>
            <span style={{ flex: 1 }} />
            <span className="num" style={{ fontSize: 13, color: r.best ? "var(--accent)" : "var(--text-2)" }}>
              {r.note}{r.best ? "  ↙ cheapest" : ""}
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 14, display: "flex", justifyContent: "space-between" }}>
        <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>checked 3 pages · spent $0.003</span>
        <span className="num" style={{ fontSize: 12, color: "var(--text-2)" }}>$0.017 returned</span>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span className="num" style={{ fontSize: 13, color: "var(--accent)" }}>{n}</span>
        <span style={{ height: 1, flex: 1, background: "var(--border)" }} />
      </div>
      <h3 className="serif" style={{ fontSize: 27, marginBottom: 10, lineHeight: 1.15 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 15.5, color: "var(--text-2)" }}>{body}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="num serif" style={{ fontSize: 44, color: "var(--accent)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 8 }}>{label}</div>
    </div>
  );
}

function UseCase({ q, sub }: { q: string; sub: string }) {
  return (
    <div className="card" style={{ padding: "22px 24px" }}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: "var(--text-1)", lineHeight: 1.25, marginBottom: 8 }}>
        “{q}”
      </div>
      <div style={{ fontSize: 14.5, color: "var(--text-2)" }}>{sub}</div>
    </div>
  );
}

export default function App() {
  return (
    <div>
      {/* ---------- NAV ---------- */}
      <nav
        style={{
          position: "fixed", top: 0, left: 0, right: 0, height: "var(--nav-h)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 32px", background: "rgba(247,245,239,.78)", backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="num" style={{ fontSize: 17, letterSpacing: ".02em", color: "var(--text-1)", fontWeight: 600 }}>
          render
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <button className="navlink hide-sm" onClick={scrollTo("how")}>How it works</button>
          <button className="navlink hide-sm" onClick={scrollTo("why")}>Why it's different</button>
          <button className="navlink hide-sm" onClick={scrollTo("uses")}>Use it for</button>
          <AgentBalance />
        </div>
      </nav>

      {/* ---------- HERO ---------- */}
      <header style={{ position: "relative", overflow: "hidden", padding: "calc(var(--nav-h) + 88px) 32px 100px" }}>
        {/* robot, resting under the words — toned to warm paper, faded into the page */}
        <div
          aria-hidden
          className="hero-robot"
          style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: "50%",
            backgroundImage: "url('/robot.jpg')", backgroundSize: "cover", backgroundPosition: "center right",
            opacity: 0.32, filter: "grayscale(0.2) sepia(0.25) contrast(1.06)",
            WebkitMaskImage: "radial-gradient(125% 92% at 88% 46%, #000 30%, transparent 78%)",
            maskImage: "radial-gradient(125% 92% at 88% 46%, #000 30%, transparent 78%)",
            pointerEvents: "none", zIndex: 0,
          }}
        />
        <div className="hero-grid" style={{ position: "relative", zIndex: 1, maxWidth: maxw, margin: "0 auto", display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 64, alignItems: "center" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 22 }}>An agent that runs your internet errands</div>
            <h1 className="serif" style={{ fontSize: 62, lineHeight: 1.04, letterSpacing: "-.01em", marginBottom: 22 }}>
              Send it to check a&nbsp;hundred websites.<br />
              <span style={{ color: "var(--text-2)" }}>Get back one answer.</span>
            </h1>
            <p style={{ fontSize: 18, color: "var(--text-2)", maxWidth: 520, marginBottom: 34 }}>
              Give it a job and a budget it can't cross. It goes out, opens the pages
              itself — even the modern ones other assistants can't read — and comes back
              with the answer plus a receipt of every fraction of a cent it spent.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={scrollTo("try")}>Try a task</button>
              <button className="btn btn-ghost" onClick={scrollTo("how")}>See how it works</button>
            </div>
          </div>
          <ReceiptCard />
        </div>
      </header>

      {/* ---------- LIVE STATS ---------- */}
      <LiveStats />

      {/* ---------- THE MECHANISM ---------- */}
      <section id="how" style={{ position: "relative", overflow: "hidden", padding: "118px 32px", borderTop: "1px solid var(--border)", background: "var(--bg-2)" }}>
        {/* the handshake — human reaching the machine, multiply drops its white field into the paper */}
        <div
          aria-hidden
          className="how-hands"
          style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: "52%",
            backgroundImage: "url('/handshake.jpg')", backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "right 18%",
            opacity: 0.55, filter: "sepia(0.15) saturate(1.1) contrast(1.05)",
            WebkitMaskImage: "radial-gradient(120% 100% at 92% 30%, #000 32%, transparent 80%)",
            maskImage: "radial-gradient(120% 100% at 92% 30%, #000 32%, transparent 80%)",
            pointerEvents: "none", zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1, maxWidth: maxw, margin: "0 auto" }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>The mechanism</div>
          <h2 className="serif" style={{ fontSize: 42, marginBottom: 64, maxWidth: 640, lineHeight: 1.12 }}>
            Room to roam, on a leash it can't slip.
          </h2>
          <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }}>
            <Step n="01" title="Set the job and the budget" body="In plain English, like a text — plus a spending cap. The budget is the leash: the agent can spend up to it and not a cent more." />
            <Step n="02" title="It does the legwork" body="It opens each page one at a time, paying a sliver of a cent to read it — and you watch every fare tick by, live." />
            <Step n="03" title="You get the answer + receipt" body="The result, plus a receipt showing exactly where every cent went and how much budget came back unspent." />
          </div>
        </div>
      </section>

      {/* ---------- WHY IT'S DIFFERENT ---------- */}
      <section id="why" style={{ padding: "118px 32px", borderTop: "1px solid var(--border)" }}>
        <div className="why-grid" style={{ maxWidth: maxw, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Why it's different</div>
            <h2 className="serif" style={{ fontSize: 42, lineHeight: 1.12, marginBottom: 22 }}>
              It can actually see the pages other assistants can't.
            </h2>
            <p style={{ fontSize: 16.5, color: "var(--text-2)", marginBottom: 18 }}>
              Most AI helpers look at a modern website and see a blank wall — the page
              never finishes loading for them. render opens each page the way a real
              person's browser would, so it can read the parts that actually matter.
            </p>
            <p style={{ fontSize: 16.5, color: "var(--text-2)", margin: 0 }}>
              That work isn't free — opening a page takes real computing power. So render
              pays a fraction of a cent for each one, only when it needs it. No
              subscription, no monthly bill. You pay for the peeking, nothing more.
            </p>
          </div>
          <div style={{ display: "grid", gap: 18 }}>
            <Stat value="~$0.001" label="per page it opens — too small to charge on a card, normal here." />
            <Stat value="0" label="subscriptions, logins, or card details to hand over." />
          </div>
        </div>
      </section>

      {/* ---------- USE CASES ---------- */}
      <section id="uses" style={{ padding: "118px 32px", borderTop: "1px solid var(--border)", background: "var(--bg-2)" }}>
        <div style={{ maxWidth: maxw, margin: "0 auto" }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Use it for</div>
          <h2 className="serif" style={{ fontSize: 42, marginBottom: 56, maxWidth: 640, lineHeight: 1.12 }}>
            The errands that are death by a thousand tabs.
          </h2>
          <div className="uses-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <UseCase q="Which of these 5 shops has the cheapest PS5 right now?" sub="Compare prices across stores without opening a single tab." />
            <UseCase q="Tell me the second this ticket drops under $80." sub="It keeps watching the page so you don't have to." />
            <UseCase q="Which of these 8 listings actually allow dogs?" sub="It reads the fine print on every one and reports back." />
            <UseCase q="Find the cheapest Friday flight to Lagos across these sites." sub="The boring comparison, done while you do something else." />
          </div>
        </div>
      </section>

      {/* ---------- TRY (the live task console) ---------- */}
      <section id="try" style={{ padding: "126px 32px", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 880, margin: "0 auto 40px", textAlign: "center" }}>
          <div className="eyebrow" style={{ marginBottom: 18 }}>Try a task</div>
          <h2 className="serif" style={{ fontSize: 48, lineHeight: 1.1, marginBottom: 20 }}>
            Give it a job. Watch it pay its way.
          </h2>
          <p style={{ fontSize: 17, color: "var(--text-2)", maxWidth: 620, margin: "0 auto" }}>
            Set a goal and a budget it can't cross. Every fare below is a real USDC settlement on Arc,
            paid through Circle Gateway from the agent's own on-chain wallet — which you can inspect.
          </p>
        </div>
        <TaskConsole />
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer style={{ padding: "44px 32px", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: maxw, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div className="num" style={{ fontSize: 15, color: "var(--text-1)", fontWeight: 600 }}>render</div>
          <div className="num" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            An autonomous web-errand agent · built on Arc
          </div>
        </div>
      </footer>
    </div>
  );
}

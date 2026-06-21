const scrollTo = (id: string) => () =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

const maxw = 1100;

function Coin() {
  return <span className="coin" aria-hidden />;
}

// --- illustrative receipt rows (a sample task, clearly labelled — not live data) ---
const sampleRows = [
  { site: "bestbuy.com", paid: "0.001", note: "$129.99" },
  { site: "amazon.com", paid: "0.001", note: "$118.49" },
  { site: "newegg.com", paid: "0.001", note: "$124.00" },
  { site: "microcenter.com", paid: "0.001", note: "$109.99", best: true },
];

function ReceiptCard() {
  return (
    <div className="card" style={{ padding: 22, fontFamily: "var(--font-num)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <span className="eyebrow">A sample errand</span>
        <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>budget · $0.02</span>
      </div>
      <div style={{ fontFamily: "var(--font-body)", color: "var(--text-1)", fontSize: 15, marginBottom: 18 }}>
        “Find the cheapest 1TB SSD across these stores.”
      </div>
      <div style={{ display: "grid", gap: 11 }}>
        {sampleRows.map((r) => (
          <div key={r.site} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Coin />
            <span className="num" style={{ fontSize: 13, color: "var(--text-2)", minWidth: 138 }}>{r.site}</span>
            <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>paid ${r.paid}</span>
            <span style={{ flex: 1 }} />
            <span
              className="num"
              style={{ fontSize: 13, color: r.best ? "var(--accent)" : "var(--text-2)" }}
            >
              {r.note}{r.best ? "  ↙ cheapest" : ""}
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 14, display: "flex", justifyContent: "space-between" }}>
        <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>checked 4 sites · spent $0.004</span>
        <span className="num" style={{ fontSize: 12, color: "var(--text-2)" }}>$0.016 returned</span>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div className="num" style={{ fontSize: 13, color: "var(--accent)", marginBottom: 14 }}>{n}</div>
      <h3 className="serif" style={{ fontSize: 26, marginBottom: 10, lineHeight: 1.2 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 15.5, color: "var(--text-2)" }}>{body}</p>
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
          padding: "0 32px", background: "rgba(11,11,14,.72)", backdropFilter: "blur(12px)",
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
          <button className="btn btn-primary" onClick={scrollTo("try")}>Try a task</button>
        </div>
      </nav>

      {/* ---------- HERO ---------- */}
      <header style={{ padding: "calc(var(--nav-h) + 90px) 32px 100px" }}>
        <div className="hero-grid" style={{ maxWidth: maxw, margin: "0 auto", display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 64, alignItems: "center" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 22 }}>An agent that runs your internet errands</div>
            <h1 className="serif" style={{ fontSize: 60, lineHeight: 1.05, letterSpacing: "-.01em", marginBottom: 22 }}>
              Send it to check a&nbsp;hundred websites.<br />
              <span style={{ color: "var(--text-2)" }}>Get back one answer.</span>
            </h1>
            <p style={{ fontSize: 18, color: "var(--text-2)", maxWidth: 520, marginBottom: 34 }}>
              Give it a job and a tiny budget. It goes out, opens the pages itself —
              even the modern ones other assistants can't read — and comes back with the
              answer plus a receipt of every fraction of a cent it spent.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={scrollTo("try")}>Try a task</button>
              <button className="btn btn-ghost" onClick={scrollTo("how")}>See how it works</button>
            </div>
          </div>
          <ReceiptCard />
        </div>
      </header>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" style={{ padding: "120px 32px", borderTop: "1px solid var(--border)", background: "var(--bg-2)" }}>
        <div style={{ maxWidth: maxw, margin: "0 auto" }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>How it works</div>
          <h2 className="serif" style={{ fontSize: 40, marginBottom: 64, maxWidth: 620, lineHeight: 1.12 }}>
            Like texting a tireless intern who works for pennies.
          </h2>
          <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }}>
            <Step n="01" title="Tell it the job" body="In plain English, like a text. “Which of these shops has the cheapest PS5 right now?” Set a spending cap so it can never overspend." />
            <Step n="02" title="It does the legwork" body="It opens each page one by one — and you watch it tick by live. Every peek costs a sliver of a cent, so you can see it's really out there working." />
            <Step n="03" title="You get the answer" body="The cheapest price, the listings that fit, the result — plus a receipt showing exactly where every cent went and how much came back unused." />
          </div>
        </div>
      </section>

      {/* ---------- WHY IT'S DIFFERENT ---------- */}
      <section id="why" style={{ padding: "120px 32px", borderTop: "1px solid var(--border)" }}>
        <div className="why-grid" style={{ maxWidth: maxw, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Why it's different</div>
            <h2 className="serif" style={{ fontSize: 40, lineHeight: 1.12, marginBottom: 22 }}>
              It can actually see the pages other assistants can't.
            </h2>
            <p style={{ fontSize: 16.5, color: "var(--text-2)", marginBottom: 18 }}>
              Most AI helpers look at a modern website and see a blank wall — the page
              never finishes loading for them. render opens each page the way a real
              person's browser would, so it can read the parts that actually matter.
            </p>
            <p style={{ fontSize: 16.5, color: "var(--text-2)", margin: 0 }}>
              That work isn't free — opening a page takes real computing power. So render
              pays a fraction of a cent for each one, only when it actually needs it. No
              subscription, no monthly bill. You pay for the peeking, nothing more.
            </p>
          </div>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="card" style={{ padding: 24 }}>
              <div className="num serif" style={{ fontSize: 44, color: "var(--accent)", lineHeight: 1 }}>~$0.001</div>
              <div style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 8 }}>per page it opens — too small to charge on a card, normal here.</div>
            </div>
            <div className="card" style={{ padding: 24 }}>
              <div className="num serif" style={{ fontSize: 44, color: "var(--text-1)", lineHeight: 1 }}>0</div>
              <div style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 8 }}>subscriptions, logins, or card details to hand over.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- USE CASES ---------- */}
      <section id="uses" style={{ padding: "120px 32px", borderTop: "1px solid var(--border)", background: "var(--bg-2)" }}>
        <div style={{ maxWidth: maxw, margin: "0 auto" }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Use it for</div>
          <h2 className="serif" style={{ fontSize: 40, marginBottom: 56, maxWidth: 620, lineHeight: 1.12 }}>
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

      {/* ---------- TRY (placeholder for the live app) ---------- */}
      <section id="try" style={{ padding: "130px 32px", borderTop: "1px solid var(--border)", textAlign: "center" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div className="eyebrow" style={{ marginBottom: 18 }}>Try a task</div>
          <h2 className="serif" style={{ fontSize: 46, lineHeight: 1.1, marginBottom: 20 }}>
            Give it a job. Watch it pay its way.
          </h2>
          <p style={{ fontSize: 17, color: "var(--text-2)", marginBottom: 34 }}>
            The live version is coming together now — you'll start with a small balance on us,
            so you can try it without signing up for anything.
          </p>
          <button className="btn btn-primary" disabled style={{ opacity: .6, cursor: "default" }}>
            Live demo · in progress
          </button>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer style={{ padding: "44px 32px", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: maxw, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div className="num" style={{ fontSize: 15, color: "var(--text-1)", fontWeight: 600 }}>render</div>
          <div className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>
            An autonomous web-errand agent · built on Arc
          </div>
        </div>
      </footer>
    </div>
  );
}

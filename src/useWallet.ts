import { useState, useCallback, useEffect } from "react";

const ORCH = (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? "http://localhost:4100";
const CIRCLE_APP_ID = (import.meta.env.VITE_CIRCLE_APP_ID as string | undefined) ?? "";
const ARC_RPC = "https://rpc.testnet.arc.network";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

interface WalletSession {
  userId: string;
  userToken: string;
  encryptionKey: string;
  walletId: string;
  address: string;
  username: string;
}

const STORAGE_KEY = "render_session";

function loadSession(): WalletSession | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** Run a Circle challenge (PIN prompt) in the web SDK and wait for the user to approve it. */
async function executeChallenge(challengeId: string, userToken: string, encryptionKey: string): Promise<void> {
  const mod = await import("@circle-fin/w3s-pw-web-sdk");
  const W3SSdk = mod.W3SSdk ?? mod.default;
  const sdk = new W3SSdk();
  sdk.setAppSettings({ appId: CIRCLE_APP_ID });
  sdk.setAuthentication({ userToken, encryptionKey });
  await new Promise<void>((resolve, reject) => {
    sdk.execute(challengeId, (err: unknown) => {
      if (err) reject(err instanceof Error ? err : new Error(String((err as { message?: string })?.message ?? err)));
      else resolve();
    });
  });
}

async function readUsdcBalance(address: string): Promise<string> {
  const padded = address.slice(2).toLowerCase().padStart(64, "0");
  const res = await fetch(ARC_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: USDC_ADDRESS, data: `0x70a08231${padded}` }, "latest"],
    }),
  });
  const json = await res.json();
  if (!json.result || json.result === "0x") return "0.00";
  const raw = BigInt(json.result);
  const whole = raw / 1_000_000n;
  const frac = (raw % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

export function useWallet() {
  const [session, setSession] = useState<WalletSession | null>(loadSession);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(!!CIRCLE_APP_ID);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (CIRCLE_APP_ID) return;
    fetch(`${ORCH}/auth/configured`)
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured === true))
      .catch(() => {});
  }, []);

  // Refresh token for returning users on mount
  useEffect(() => {
    const saved = loadSession();
    if (!saved?.username) return;
    fetch(`${ORCH}/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: saved.username, login: true }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(({ userToken, encryptionKey }) => {
        const refreshed = { ...saved, userToken, encryptionKey };
        setSession(refreshed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
      })
      .catch(() => {});
  }, []);

  const signUp = useCallback(async (username: string) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const tokenRes = await fetch(`${ORCH}/auth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${tokenRes.status}`);
      }
      const { userId, userToken, encryptionKey, returning } = await tokenRes.json();

      if (returning) {
        setError("Username taken. Log in instead.");
        return;
      }

      const initRes = await fetch(`${ORCH}/auth/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userToken }),
      });
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
      const { challengeId } = await initRes.json();

      if (challengeId && CIRCLE_APP_ID) {
        await executeChallenge(challengeId, userToken, encryptionKey);
      }

      let wallet: { id: string; address: string } | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
        const walletsRes = await fetch(`${ORCH}/auth/wallets`, {
          headers: { "x-user-token": userToken },
        });
        const walletsData = await walletsRes.json();
        wallet = walletsData.wallets?.[0];
        if (wallet?.address) break;
      }

      if (wallet) {
        const s: WalletSession = { userId, userToken, encryptionKey, walletId: wallet.id, address: wallet.address, username };
        setSession(s);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      }
    } catch (e) {
      console.error("Sign-up error:", e);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const logIn = useCallback(async (username: string) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const tokenRes = await fetch(`${ORCH}/auth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, login: true }),
      });
      if (tokenRes.status === 404) {
        setError("No account found. Create one first.");
        return;
      }
      if (!tokenRes.ok) throw new Error(`Request failed: ${tokenRes.status}`);
      const { userId, userToken, encryptionKey } = await tokenRes.json();

      const walletsRes = await fetch(`${ORCH}/auth/wallets`, {
        headers: { "x-user-token": userToken },
      });
      const walletsData = await walletsRes.json();
      const wallet = walletsData.wallets?.[0];

      if (wallet) {
        const s: WalletSession = { userId, userToken, encryptionKey, walletId: wallet.id, address: wallet.address, username };
        setSession(s);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } else {
        setError("Wallet not found. Try creating a new account.");
      }
    } catch (e) {
      console.error("Login error:", e);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  /**
   * Fund a task from the user's own wallet: create a USDC transfer to the
   * agent, have the user approve it with their PIN, then wait for it to
   * confirm on Arc. Returns the Circle transaction id the orchestrator
   * verifies before running the task. Throws on failure — the caller shows
   * the error next to the task, not in the sign-in UI.
   */
  const fundTask = useCallback(async (amountUsdc: number): Promise<{ txId: string }> => {
    if (!session) throw new Error("Sign in first.");
    const fundRes = await fetch(`${ORCH}/auth/fund`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-token": session.userToken },
      body: JSON.stringify({ walletId: session.walletId, amount: amountUsdc }),
    });
    if (!fundRes.ok) {
      const err = await fundRes.json().catch(() => ({}));
      throw new Error(err.error || `Funding failed: ${fundRes.status}`);
    }
    const { challengeId, refId } = await fundRes.json();
    if (challengeId && CIRCLE_APP_ID) {
      await executeChallenge(challengeId, session.userToken, session.encryptionKey);
    }

    // Wait for the transfer to confirm on Arc (usually a few seconds).
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await fetch(`${ORCH}/auth/fund/status?refId=${encodeURIComponent(refId)}`, {
        headers: { "x-user-token": session.userToken },
      }).then((r) => r.json()).catch(() => null);
      if (!st) continue;
      if (st.state === "CONFIRMED" || st.state === "COMPLETE") {
        readUsdcBalance(session.address).then(setBalance).catch(() => {});
        return { txId: st.txId };
      }
      if (["FAILED", "DENIED", "CANCELLED"].includes(st.state)) {
        throw new Error(`Funding transfer ${String(st.state).toLowerCase()}.`);
      }
    }
    throw new Error("Funding transfer didn't confirm in time. Your USDC was not lost — check your balance and try again.");
  }, [session]);

  /** Re-read the on-chain balance now (e.g. after a refund lands). */
  const refreshBalance = useCallback(() => {
    if (session?.address) readUsdcBalance(session.address).then(setBalance).catch(() => {});
  }, [session?.address]);

  const signOut = useCallback(() => {
    setSession(null);
    setBalance(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!session?.address) {
      setBalance(null);
      return;
    }
    let live = true;
    const load = () =>
      readUsdcBalance(session.address)
        .then((b) => {
          if (live) setBalance(b);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [session?.address]);

  return {
    address: session?.address ?? null,
    username: session?.username ?? null,
    balance,
    loading,
    signUp,
    logIn,
    signOut,
    fundTask,
    refreshBalance,
    configured,
    error,
    userToken: session?.userToken ?? null,
  };
}

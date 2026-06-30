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
}

const STORAGE_KEY = "render_session";

function loadSession(): WalletSession | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
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

  useEffect(() => {
    if (CIRCLE_APP_ID) return;
    fetch(`${ORCH}/auth/configured`)
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured === true))
      .catch(() => {});
  }, []);

  const signIn = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      // 1. Create Circle user + get credentials from our backend
      const tokenRes = await fetch(`${ORCH}/auth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!tokenRes.ok) throw new Error(`Token request failed: ${tokenRes.status}`);
      const { userId, userToken, encryptionKey } = await tokenRes.json();

      // 2. Initialize wallet on ARC-TESTNET
      const initRes = await fetch(`${ORCH}/auth/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userToken }),
      });
      if (!initRes.ok) throw new Error(`Init request failed: ${initRes.status}`);
      const { challengeId } = await initRes.json();

      // 3. Execute wallet creation challenge via Circle SDK
      if (challengeId && CIRCLE_APP_ID) {
        const mod = await import("@circle-fin/w3s-pw-web-sdk");
        const W3SSdk = mod.W3SSdk ?? mod.default;
        const sdk = new W3SSdk();
        sdk.setAppSettings({ appId: CIRCLE_APP_ID });
        sdk.setAuthentication({ userToken, encryptionKey });
        await new Promise<void>((resolve, reject) => {
          sdk.execute(challengeId, (err: unknown) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      // 4. Fetch the created wallet
      const walletsRes = await fetch(`${ORCH}/auth/wallets`, {
        headers: { "x-user-token": userToken },
      });
      const walletsData = await walletsRes.json();
      const wallet = walletsData.wallets?.[0];

      if (wallet) {
        const s: WalletSession = {
          userId,
          userToken,
          encryptionKey,
          walletId: wallet.id,
          address: wallet.address,
        };
        setSession(s);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      }
    } catch (e) {
      console.error("Sign-in error:", e);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const signOut = useCallback(() => {
    setSession(null);
    setBalance(null);
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
    balance,
    loading,
    signIn,
    signOut,
    configured,
    userToken: session?.userToken ?? null,
  };
}

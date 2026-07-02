export interface Publisher {
  name: string;
  wallet: `0x${string}`;
  source: "well-known" | "registry";
}

/**
 * Pre-registered fallback so the demo works against sites that haven't published
 * the discovery file yet. In production this list is unnecessary — publishers
 * self-register by hosting /.well-known/x402.json on their own domain.
 */
const registry: Record<string, { name: string; wallet: `0x${string}` }> = {
  "webscraper.io": { name: "WebScraper.io", wallet: "0x04FaFe065CF83b218Ccf9dfa1b7aB866F4cB0063" },
};

const cache = new Map<string, Publisher | null>();

function isPrivateHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function isAddress(v: unknown): v is `0x${string}` {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

/**
 * Live, cache-free check of a domain's /.well-known/x402.json — used by the
 * publisher onboarding page's "verify my site" button. Returns a specific
 * reason on failure so site owners can fix their file.
 */
export async function verifyPublisherFile(
  domain: string,
): Promise<{ found: true; name: string; wallet: string } | { found: false; reason: string }> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return { found: false, reason: "That doesn't look like a domain." };
  if (isPrivateHost(host)) return { found: false, reason: "Private/internal hosts can't be verified." };
  try {
    const res = await fetch(`https://${host}/.well-known/x402.json`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { found: false, reason: `https://${host}/.well-known/x402.json returned ${res.status}.` };
    let data: { name?: string; wallet?: string; address?: string };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return { found: false, reason: "The file exists but isn't valid JSON." };
    }
    const wallet = data.wallet ?? data.address;
    if (!isAddress(wallet)) return { found: false, reason: 'The file needs a "wallet" field with a 0x… address.' };
    cache.set(host, { name: data.name ?? host, wallet, source: "well-known" });
    return { found: true, name: data.name ?? host, wallet };
  } catch {
    return { found: false, reason: `Couldn't reach https://${host} — is the file live?` };
  }
}

/**
 * Decide who to pay for reading a page.
 *
 * The open mechanism: fetch the publisher's own /.well-known/x402.json — any
 * site owner opts in by hosting one file that declares their USDC wallet. We
 * fall back to a small pre-registered list so the demo still flows against
 * sites that haven't published the file. Results are cached per host.
 */
export async function discoverPublisher(url: string): Promise<Publisher | null> {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (cache.has(host)) return cache.get(host)!;

  let found: Publisher | null = null;

  // 1. The standard: the publisher's own .well-known declaration.
  if (!isPrivateHost(host)) {
    try {
      const res = await fetch(`https://${host}/.well-known/x402.json`, {
        signal: AbortSignal.timeout(2500),
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { name?: string; wallet?: string; address?: string };
        const wallet = data.wallet ?? data.address;
        if (isAddress(wallet)) found = { name: data.name ?? host, wallet, source: "well-known" };
      }
    } catch {
      /* no file, unreachable, or bad JSON — fall through to the registry */
    }
  }

  // 2. Fallback: the pre-registered demo list.
  if (!found) {
    for (const [domain, p] of Object.entries(registry)) {
      if (host === domain || host.endsWith(`.${domain}`)) {
        found = { name: p.name, wallet: p.wallet, source: "registry" };
        break;
      }
    }
  }

  cache.set(host, found);
  return found;
}

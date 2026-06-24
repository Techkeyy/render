export interface Publisher {
  id: string;
  name: string;
  wallet: `0x${string}`;
}

const registry: Record<string, Publisher> = {
  "webscraper.io": {
    id: "webscraper",
    name: "WebScraper.io",
    wallet: "0x04FaFe065CF83b218Ccf9dfa1b7aB866F4cB0063",
  },
};

export function findPublisher(url: string): Publisher | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const [domain, pub] of Object.entries(registry)) {
      if (host === domain || host.endsWith(`.${domain}`)) return pub;
    }
  } catch {}
  return null;
}

export function getPublisher(id: string): Publisher | null {
  return Object.values(registry).find((p) => p.id === id) ?? null;
}

/**
 * Thin client for the Veri Express backend.
 * Falls back to sample data when the API is unreachable so the UI is always
 * explorable during development.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types — match subgraph schema
// ─────────────────────────────────────────────────────────────────────────────

export type Capability = {
  capabilityId: string;   // bytes32 hex
  name: string;           // "SELF_DESCRIBE" | "ENDPOINT_UPDATE" | "SUBAGENT_ISSUE" | "TRANSACT"
  roleBitmap: string;
  grantedAt: string;      // unix timestamp string
  revokedAt: string | null;
};

export type Agent = {
  id: string;             // labelHash hex
  label: string;          // "scanner"
  name: string;           // "scanner.veri.eth"
  agentAddress: string;
  currentTokenId: string;
  expiry: string;         // unix timestamp string
  active: boolean;
  context: string | null;
  mcpEndpoint: string | null;
  issuedAt: string;
  issuedTx: string;
  human: { id: string; agentCount: number; firstSeenAt: string };
  capabilities: Capability[];
};

export type CapabilityEvent = {
  id: string;
  action: "GRANTED" | "REVOKED";
  reason: string | null;
  capabilityId: string;
  timestamp: string;
  txHash: string;
  agent?: { name: string; label: string };
};

export type FeedEvent = CapabilityEvent & { agent: { name: string; label: string } };

export type Verification = {
  humanId: string;      // bytes32 hex — keccak256(nullifier)
  attestation: string;  // EIP-712 signature bytes
  deadline: number;     // unix timestamp
};

// ─────────────────────────────────────────────────────────────────────────────
// Capability constants (match abi.js CAP values)
// ─────────────────────────────────────────────────────────────────────────────

export const CAPABILITY_NAMES = [
  "SELF_DESCRIBE",
  "ENDPOINT_UPDATE",
  "TRANSACT",
  "SUBAGENT_ISSUE",
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

// keccak256("SELF_DESCRIBE") etc — must match VeriRegistrar.sol's CAP_* constants exactly.
// Verified against the live contract's /capabilities endpoint response.
export const CAPABILITY_ID_TO_NAME: Record<string, CapabilityName> = {
  "0xf3dda55987e4d25a6d9e3aeff8ef1168a6cfab7f38eb0fbda284435eb8d23ada": "SELF_DESCRIBE",
  "0x48ea3bb63ac2982c59b3ceb0839bc3ef7acf2be500136f65c0c34349bd965f23": "ENDPOINT_UPDATE",
  "0x45ac1de79a69f4f75dcd7b8f307230542872b80bb4b9365d701b0aab683d5869": "SUBAGENT_ISSUE",
  "0xa09790668486ea0c181d3e6064eb27239d58f632dd715391576ea4e6e720c1be": "TRANSACT",
};

export function capabilityName(capabilityId: string): string {
  return CAPABILITY_ID_TO_NAME[capabilityId] ?? capabilityId.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export const API_BASE = (
  (import.meta.env as Record<string, string | undefined>)["VITE_API_URL"] ??
  "http://localhost:8787"
).replace(/\/$/, "");

export const WORLD_APP_ID = (
  (import.meta.env as Record<string, string | undefined>)["VITE_WORLD_APP_ID"] ?? ""
);

// ─────────────────────────────────────────────────────────────────────────────
// Sample data (shown when backend is unreachable)
// ─────────────────────────────────────────────────────────────────────────────

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;

function sampleAgent(label: string, caps: CapabilityName[], daysLeft: number): Agent {
  const expiry = String(now + daysLeft * DAY);
  return {
    id: "0x" + label.padEnd(64, "0"),
    label,
    name: `${label}.veri.eth`,
    agentAddress: "0x5f2b" + label.length.toString(16).padStart(60, "0"),
    currentTokenId: "1",
    expiry,
    active: daysLeft > 0,
    context: `${label} is an AI agent registered on Veri.`,
    mcpEndpoint: `https://${label}.example.com/mcp`,
    issuedAt: String(now - 30 * DAY),
    issuedTx: "0x" + "a".repeat(64),
    human: { id: "0x" + "b".repeat(64), agentCount: 1, firstSeenAt: String(now - 30 * DAY) },
    capabilities: caps.map((name) => ({
      capabilityId: "0x" + name.padEnd(64, "0"),
      name,
      roleBitmap: "1",
      grantedAt: String(now - 29 * DAY),
      revokedAt: null,
    })),
  };
}

const SAMPLE_AGENTS: Agent[] = [
  sampleAgent("scanner",   ["SELF_DESCRIBE", "ENDPOINT_UPDATE", "TRANSACT"], 74),
  sampleAgent("alpha",     ["TRANSACT"],                                      41),
  sampleAgent("linter",    ["SELF_DESCRIBE", "ENDPOINT_UPDATE"],              12),
  sampleAgent("indexer",   ["SELF_DESCRIBE"],                                 63),
  sampleAgent("research",  ["SELF_DESCRIBE", "ENDPOINT_UPDATE", "TRANSACT"], 88),
  sampleAgent("assistant", ["SELF_DESCRIBE", "ENDPOINT_UPDATE", "SUBAGENT_ISSUE"], 28),
];

const SAMPLE_FEED: FeedEvent[] = [
  { id: "1", action: "REVOKED",  reason: "Human withdrew permission", capabilityId: "0x0", timestamp: String(now - 120),     txHash: "0x1", agent: { name: "badbot.veri.eth",      label: "badbot"  } },
  { id: "2", action: "GRANTED",  reason: null,                         capabilityId: "0x0", timestamp: String(now - 840),     txHash: "0x2", agent: { name: "oracle.veri.eth",      label: "oracle"  } },
  { id: "3", action: "REVOKED",  reason: "Retired",                    capabilityId: "0x0", timestamp: String(now - 2460),    txHash: "0x3", agent: { name: "ghostwriter.veri.eth", label: "ghostwriter" } },
  { id: "4", action: "GRANTED",  reason: null,                         capabilityId: "0x0", timestamp: String(now - 5760),    txHash: "0x4", agent: { name: "scanner.veri.eth",     label: "scanner" } },
];

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: "application/json" },
      signal:  AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(err.error ?? String(res.status));
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// API calls
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAgents(capability?: string): Promise<Agent[]> {
  const path = capability
    ? `/agents/search?capability=${encodeURIComponent(capability)}`
    : "/agents";
  const data = await get<{ agents: Agent[] }>(path, { agents: [] });
  if (data.agents.length) return data.agents;
  return capability
    ? SAMPLE_AGENTS.filter(
        (a) =>
          a.capabilities.some((c) => c.name.toLowerCase().includes(capability.toLowerCase())) ||
          a.label.toLowerCase().includes(capability.toLowerCase()),
      )
    : SAMPLE_AGENTS;
}

export async function fetchAgent(subname: string): Promise<Agent | null> {
  const data = await get<{ agent: Agent | null }>(
    `/agents/${encodeURIComponent(subname)}`,
    { agent: null },
  );
  return data.agent ?? SAMPLE_AGENTS.find((a) => a.name === subname) ?? null;
}

export async function fetchFeed(): Promise<FeedEvent[]> {
  const data = await get<{ events: FeedEvent[] }>("/feed?limit=20", { events: [] });
  return data.events.length ? data.events : SAMPLE_FEED;
}

export async function fetchHistory(subname: string): Promise<CapabilityEvent[]> {
  const data = await get<{ history: CapabilityEvent[] }>(
    `/agents/${encodeURIComponent(subname)}/history`,
    { history: [] },
  );
  if (data.history.length) return data.history;
  return [
    { id: "1", action: "GRANTED", reason: null,        capabilityId: "0x1", timestamp: String(now - 90 * DAY), txHash: "0xa" },
    { id: "2", action: "GRANTED", reason: null,        capabilityId: "0x2", timestamp: String(now - 89 * DAY), txHash: "0xb" },
    { id: "3", action: "REVOKED", reason: "Temporary", capabilityId: "0x1", timestamp: String(now -  5 * DAY), txHash: "0xc" },
  ];
}

// World ID — get RP signature (called before opening IDKit widget)
// Backend route is a GET, not a POST — must not go through the generic post() helper.
export async function getRpSignature(): Promise<{
  rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string;
}> {
  const res = await fetch(`${API_BASE}/rp-signature`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(err.error ?? String(res.status));
  }
  return res.json();
}

// Submit verified proof → get humanId + EIP-712 attestation
export async function verifyProof(
  proofPayload: Record<string, unknown>,
  userAddress: string,
): Promise<Verification> {
  return post<Verification>("/verify-proof", { ...proofPayload, userAddress });
}

// Encode issueAgent calldata
export async function prepareRegister(body: {
  label: string;
  agentAddress: string;
  humanId: string;
  capabilityIds: string[];
  attestation: string;
  deadline: number;
}): Promise<{ to: string; data: string; value: string }> {
  return post("/register", body);
}

// Encode grantCapability calldata
export async function prepareGrant(label: string, capabilityId: string) {
  return post<{ to: string; data: string; value: string }>("/grant", { label, capabilityId });
}

// Encode revokeCapability calldata
export async function prepareRevoke(label: string, capabilityId: string, reason: string) {
  return post<{ to: string; data: string; value: string }>("/revoke", {
    label,
    capabilityId,
    reason,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

export function timeAgo(timestamp: number | string) {
  const diff = Math.max(1, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function countdown(seconds: number) {
  if (seconds <= 0) return "expired";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

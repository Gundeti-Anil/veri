import express from "express";
import cors from "cors";
import { config, isConfigured } from "./config.js";
import { CAP } from "./abi.js";
import {
  signAttestation,
  encodeIssueAgent,
  encodeGrantCapability,
  encodeRevokeCapability,
  encodeRetireAgent,
} from "./contract.js";
import {
  fetchAgents,
  fetchAgent,
  fetchAgentHistory,
  fetchFeed,
  fetchProtocolStats,
} from "./graph.js";
import {
  signWorldRequest,
  verifyWorldProof,
  checkAndStoreNullifier,
  computeHumanId,
} from "./world.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const ok   = (res, data) => res.json(data);
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) =>
  ok(res, {
    status:      "ok",
    chain:       "sepolia",
    registrar:   config.registrarAddress || null,
    subgraph:    config.subgraphUrl      || null,
    worldRpId:   config.worldRpId        || null,
    configured:  isConfigured,
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent reads (all from subgraph)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /agents → all active agents */
app.get("/agents", async (_req, res) => {
  try {
    ok(res, { agents: await fetchAgents() });
  } catch (e) {
    fail(res, 502, `Subgraph error: ${e.message}`);
  }
});

/** GET /agents/search?capability=SELF_DESCRIBE */
app.get("/agents/search", async (req, res) => {
  const q = String(req.query.capability || "").toLowerCase();
  if (!q) return fail(res, 400, "capability query param is required");
  try {
    const all = await fetchAgents();
    // Filter by capability name or agent label/name
    const filtered = all.filter((a) => {
      const inCaps  = (a.capabilities || []).some((c) =>
        c.name.toLowerCase().includes(q)
      );
      const inLabel = a.label.toLowerCase().includes(q) ||
                      a.name.toLowerCase().includes(q);
      return inCaps || inLabel;
    });
    ok(res, { agents: filtered });
  } catch (e) {
    fail(res, 502, `Subgraph error: ${e.message}`);
  }
});

/** GET /agents/:subname/history → capability event history */
app.get("/agents/:subname/history", async (req, res) => {
  try {
    ok(res, { history: await fetchAgentHistory(req.params.subname) });
  } catch (e) {
    fail(res, 502, `Subgraph error: ${e.message}`);
  }
});

/** GET /agents/:subname */
app.get("/agents/:subname", async (req, res) => {
  try {
    const agent = await fetchAgent(req.params.subname);
    if (!agent) return fail(res, 404, "Agent not found");
    ok(res, { agent });
  } catch (e) {
    fail(res, 502, `Subgraph error: ${e.message}`);
  }
});

/** GET /feed → recent capability events */
app.get("/feed", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 20), 100);
  try {
    ok(res, { events: await fetchFeed(limit) });
  } catch (e) {
    fail(res, 502, `Subgraph error: ${e.message}`);
  }
});

/** GET /stats → protocol-level totals */
app.get("/stats", async (_req, res) => {
  try {
    ok(res, { stats: await fetchProtocolStats() });
  } catch (e) {
    fail(res, 502, `Subgraph error: ${e.message}`);
  }
});

/** GET /capabilities → known capability IDs */
app.get("/capabilities", (_req, res) =>
  ok(res, {
    capabilities: [
      { id: CAP.SELF_DESCRIBE,   name: "SELF_DESCRIBE",   description: "Agent can write its own agent-context record" },
      { id: CAP.ENDPOINT_UPDATE, name: "ENDPOINT_UPDATE", description: "Agent can write agent-endpoint[*] records" },
      { id: CAP.SUBAGENT_ISSUE,  name: "SUBAGENT_ISSUE",  description: "Agent can set a sub-registry and issue sub-agents" },
      { id: CAP.TRANSACT,        name: "TRANSACT",         description: "Off-chain signal: relying parties may transact with this agent" },
    ],
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// World ID Selfie Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /rp-signature
 * Frontend requests this before opening the IDKit widget.
 * Returns the signed RP context that IDKit needs in `rp_context`.
 * NEVER expose WORLD_SIGNING_KEY to the client.
 */
app.get("/rp-signature", async (_req, res) => {
  try {
    ok(res, await signWorldRequest());
  } catch (e) {
    fail(res, 500, `RP signature failed: ${e.message}`);
  }
});

/**
 * POST /verify-proof
 * Body: IDKit proof payload (as-is from onSuccess callback) + userAddress.
 * Returns: { humanId, attestation, deadline } on success.
 *
 * This endpoint:
 *   1. Verifies the ZK proof against World API v4.
 *   2. Checks the nullifier has not been used before (replay protection).
 *   3. Stores the nullifier.
 *   4. Computes humanId = keccak256(abi.encode(nullifier)) — never exposes raw nullifier.
 *   5. Signs an EIP-712 attestation binding humanId → userAddress → deadline.
 */
app.post("/verify-proof", async (req, res) => {
  console.log("[veri] /verify-proof incoming body:", JSON.stringify(req.body));
  const { userAddress } = req.body || {};
  if (!userAddress) return fail(res, 400, "userAddress is required");

  try {
    // 1. Verify ZK proof with World
    const verification = await verifyWorldProof(req.body);
    if (!verification.verified) {
      return fail(res, 400, verification.error || "World verification failed");
    }

    const nullifier = verification.nullifier;

    // 2 + 3. Replay protection
    const stored = checkAndStoreNullifier(nullifier);
    if (!stored.ok) return fail(res, 409, stored.error);

    // 4. Derive humanId — raw nullifier stays in this function
    const humanId = computeHumanId(nullifier);

    // 5. Sign EIP-712 attestation
    const { attestation, deadline } = await signAttestation(humanId, userAddress);

    ok(res, { humanId, attestation, deadline });
  } catch (e) {
    fail(res, 500, `Verification error: ${e.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Transaction calldata builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /register
 * Body: { label, agentAddress, humanId, capabilityIds[], attestation, deadline }
 * Returns: { to, data, value: "0", chainId } — frontend signs and broadcasts.
 *
 * No ETH deposit: ENSv2 fees are in MockUSDC (paid by the registrar setup).
 */
app.post("/register", (req, res) => {
  const { label, agentAddress, humanId, capabilityIds, attestation, deadline } = req.body || {};

  if (!label || !agentAddress || !humanId || !attestation || !deadline) {
    return fail(res, 400, "label, agentAddress, humanId, attestation, deadline are required");
  }
  if (!config.registrarAddress) {
    return fail(res, 503, "VERI_REGISTRAR_ADDRESS is not configured");
  }

  try {
    const data = encodeIssueAgent(
      label,
      agentAddress,
      humanId,
      capabilityIds ?? [],
      attestation,
      deadline
    );

    ok(res, {
      to:      config.registrarAddress,
      data,
      value:   "0",          // no ETH — ENSv2 fees are stablecoins
      chainId: 11155111,
    });
  } catch (e) {
    fail(res, 400, `Calldata encoding failed: ${e.message}`);
  }
});

/**
 * POST /grant
 * Body: { label, capabilityId }
 * Returns prepared grantCapability calldata.
 */
app.post("/grant", (req, res) => {
  const { label, capabilityId } = req.body || {};
  if (!label || !capabilityId) return fail(res, 400, "label and capabilityId required");
  try {
    ok(res, {
      to:      config.registrarAddress,
      data:    encodeGrantCapability(label, capabilityId),
      value:   "0",
      chainId: 11155111,
    });
  } catch (e) {
    fail(res, 400, `Encoding failed: ${e.message}`);
  }
});

/**
 * POST /revoke
 * Body: { label, capabilityId, reason }
 * Returns prepared revokeCapability calldata.
 */
app.post("/revoke", (req, res) => {
  const { label, capabilityId, reason } = req.body || {};
  if (!label || !capabilityId) return fail(res, 400, "label and capabilityId required");
  try {
    ok(res, {
      to:      config.registrarAddress,
      data:    encodeRevokeCapability(label, capabilityId, reason ?? ""),
      value:   "0",
      chainId: 11155111,
    });
  } catch (e) {
    fail(res, 400, `Encoding failed: ${e.message}`);
  }
});

/**
 * POST /retire
 * Body: { label }
 * Returns prepared retireAgent calldata.
 */
app.post("/retire", (req, res) => {
  const { label } = req.body || {};
  if (!label) return fail(res, 400, "label required");
  try {
    ok(res, {
      to:      config.registrarAddress,
      data:    encodeRetireAgent(label),
      value:   "0",
      chainId: 11155111,
    });
  } catch (e) {
    fail(res, 400, `Encoding failed: ${e.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 404
// ─────────────────────────────────────────────────────────────────────────────

app.use((_req, res) => fail(res, 404, "Not found"));

// Vercel imports this module as a serverless function handler (no app.listen
// needed — its runtime owns the HTTP server). Only listen when run directly,
// e.g. `node src/index.js` locally or on a plain Node host like Render.
if (!process.env.VERCEL) {
app.listen(config.port, () => {
  console.log(`[veri] backend on http://localhost:${config.port}`);
  console.log(`[veri] registrar: ${config.registrarAddress || "(not set)"}`);
  console.log(`[veri] subgraph:  ${config.subgraphUrl      || "(not set)"}`);
  console.log(`[veri] worldRpId: ${config.worldRpId        || "(not set)"}`);
});
}

export default app;

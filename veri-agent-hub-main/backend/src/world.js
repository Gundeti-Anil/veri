/**
 * World ID Selfie Check integration — backend only.
 *
 * Flow (spec §3):
 *   1. signWorldRequest()  → RP signature for the IDKit widget
 *   2. verifyWorldProof()  → forward proof to World v4 API, extract nullifier
 *   3. checkAndStoreNullifier() → replay protection (Portal only checks ZK validity)
 *   4. computeHumanId()    → keccak256(abi.encode(nullifier)) — never the raw nullifier
 *
 * Trust note: ZK proof is verified by the World backend, not on Sepolia chain.
 * The attestor key bridges the trust gap. Stated openly in README.
 */
import { ethers } from "ethers";
import { signRequest } from "@worldcoin/idkit-server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { config } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Nullifier persistence (JSON file — production should use Postgres NUMERIC(78,0))
// ─────────────────────────────────────────────────────────────────────────────

function loadNullifiers() {
  if (!existsSync(config.nullifiersFile)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(config.nullifiersFile, "utf8")));
  } catch {
    return new Set();
  }
}

function saveNullifiers(set) {
  writeFileSync(config.nullifiersFile, JSON.stringify([...set]));
}

// In-memory copy; synced to file on every write.
const usedNullifiers = loadNullifiers();

// ─────────────────────────────────────────────────────────────────────────────
// RP Signature
//
// The World IDKit Selfie Check requires a server-side RP signature so the
// signing key is never exposed to the client.
//
// [VERIFY] the exact signRequest() format against @worldcoin/idkit-core docs.
// This implementation follows the spec: sign(nonce || action) with the
// WORLD_SIGNING_KEY private key via ECDSA (secp256k1).
// ─────────────────────────────────────────────────────────────────────────────

export async function signWorldRequest() {
  if (!config.worldSigningKey) {
    // Dev fallback — real Selfie Check will fail at the World API step
    const now = Math.floor(Date.now() / 1000);
    return {
      rp_id:      config.worldRpId || "dev",
      nonce:      "0x" + "0".repeat(64),
      created_at: now,
      expires_at: now + 300,
      signature:  "0x" + "0".repeat(130),
    };
  }

  // Uses the official reference implementation — this message format (version ||
  // nonce || createdAt || expiresAt || action-field-hash, signed as an EIP-191
  // Ethereum message) is exact protocol spec, not something to hand-roll. An
  // earlier hand-rolled version here (keccak256(nonce+action+createdAt) via a
  // plain signMessage) used a completely different byte layout and always
  // caused World to reject the request with a generic "generic_error".
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: config.worldSigningKey,
    action:        config.worldAction,
  });

  return {
    rp_id:      config.worldRpId,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
    signature:  sig,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof verification
//
// Forwards the IDKit result as-is to World API v4 (spec: "no field remapping").
// Returns { verified: true, nullifier: string } on success.
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyWorldProof(payload) {
  const { proof, merkle_root, nullifier_hash, verification_level, protocol_version, rp_context } = payload || {};

  if (!proof || !merkle_root || !nullifier_hash) {
    return { verified: false, error: "Incomplete World proof payload" };
  }

  if (config.worldStubVerify) {
    return { verified: true, nullifier: nullifier_hash };
  }

  if (!config.worldRpId) {
    // Dev mode: skip real verification, return mock
    console.warn("[veri/world] WORLD_RP_ID not set — skipping real verification (dev mode)");
    return { verified: true, nullifier: nullifier_hash };
  }

  // Forward proof as-is to World v4 — spec §3: "no field remapping"
  const outgoingBody = {
    action:  config.worldAction,
    signal:  payload.signal ?? "",
    protocol_version: protocol_version ?? "3.0",
    // Confirmed by direct API probing: the verify endpoint wants a flat
    // top-level `nonce` (the same nonce issued in rp_context by
    // signWorldRequest), NOT the nested rp_context object itself.
    nonce: rp_context?.nonce,
    allow_legacy_proofs: true,
    // v4 verify API expects the original World ID v3 responses[] field
    // names — `identifier` and `nullifier`, NOT `verification_level` /
    // `nullifier_hash` (confirmed by direct API probing: sending the
    // latter names produced "identifier is required, nullifier is
    // required for v3" even with a valid protocol_version).
    responses: [
      {
        proof,
        merkle_root,
        nullifier: nullifier_hash,
        identifier: verification_level ?? "orb",
      },
    ],
  };

  console.log("[veri/world] outgoing verify body:", JSON.stringify(outgoingBody));

  // The staging verify host (staging-developer.worldcoin.org) always returns
  // "app_not_migrated" regardless of app config — confirmed by direct
  // probing, it's a platform-wide limitation, not a per-app issue. Production
  // is the correct host even for Sandbox-generated proofs.
  const res = await fetch(
    `https://developer.world.org/api/v4/verify/${config.worldRpId}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outgoingBody),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    console.log("[veri/world] verify rejected:", detail);
    return { verified: false, error: `World verification failed: ${detail}` };
  }

  const json = await res.json();
  // v4 response shape [VERIFY]: { nullifier_hash, ... }
  return { verified: true, nullifier: json.nullifier_hash ?? nullifier_hash };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nullifier replay protection
//
// The World Portal only verifies the ZK proof is valid — it does NOT prevent
// replays. That is the backend's job (spec §3).
//
// Nullifiers are stored as decimal strings for consistent comparison.
// Production: store as NUMERIC(78, 0) in Postgres with UNIQUE constraint.
// ─────────────────────────────────────────────────────────────────────────────

export function checkAndStoreNullifier(nullifierHex) {
  // Convert to decimal string for consistent storage/comparison
  const decimal = BigInt(nullifierHex).toString(10);

  if (usedNullifiers.has(decimal)) {
    return { ok: false, error: "Nullifier already used — this human already verified" };
  }

  usedNullifiers.add(decimal);
  saveNullifiers(usedNullifiers);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// humanId derivation
//
// humanId = keccak256(abi.encode(nullifier as uint256))
// Must match VeriRegistrar.sol exactly. The raw nullifier is NEVER stored
// on-chain or in the subgraph.
// ─────────────────────────────────────────────────────────────────────────────

export function computeHumanId(nullifierHex) {
  const nullifierBigInt = BigInt(nullifierHex);
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256"],
    [nullifierBigInt]
  );
  return ethers.keccak256(encoded); // bytes32 hex string
}

import "dotenv/config";

export const config = {
  port:               Number(process.env.PORT || 8787),
  rpcUrl:             process.env.RPC_URL || "",

  // VeriRegistrar on Sepolia — set after Deploy.s.sol
  registrarAddress:   process.env.VERI_REGISTRAR_ADDRESS || "",

  // Subgraph Studio endpoint — set after graph deploy
  subgraphUrl:        process.env.SUBGRAPH_URL || "",

  // Attestor EIP-712 signing key (backend only — never expose to client)
  attestorPrivateKey: process.env.ATTESTOR_PRIVATE_KEY || "",

  // World ID — Selfie Check
  worldAppId:         process.env.WORLD_APP_ID || "",
  worldRpId:          process.env.WORLD_RP_ID  || "",     // rp_id from Developer Portal
  worldSigningKey:    process.env.WORLD_SIGNING_KEY || "", // signing_key from Developer Portal
  worldAction:        process.env.WORLD_ACTION || "register-agent",

  worldStubVerify:    process.env.WORLD_STUB_VERIFY === "true",

  // File path for nullifier persistence (JSON array on disk). Vercel's
  // serverless filesystem is read-only outside /tmp, and /tmp doesn't
  // persist across invocations — fine for this hackathon build, but note
  // that replay protection resets between cold starts on Vercel.
  nullifiersFile:     process.env.NULLIFIERS_FILE || (process.env.VERCEL ? "/tmp/nullifiers.json" : "./nullifiers.json"),
};

export const isConfigured = Boolean(
  config.registrarAddress && config.attestorPrivateKey
);

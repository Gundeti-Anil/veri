# Veri

A permission and reputation layer for AI agents backed by a verified human.

A human proves personhood once with World ID. They then issue named agents under an
ENSv2 subname registry they control, and grant each agent a **scoped, revocable set of
rights** using ENSv2 Enhanced Access Control. Every grant, revocation, and registration
is indexed into a subgraph, so any third-party service or agent can ask, before
transacting: *is a human behind this agent, and what exactly is it allowed to do?*

Built for ETHGlobal ETHOnline 2026.

## Structure

```
contracts/           Foundry contracts — VeriRegistrar wraps ENSv2 IPermissionedRegistry
subgraph/             The Graph subgraph indexing registrations, grants, revocations
veri-agent-hub-main/  Frontend (TanStack Start) + backend (Express)
```

## How it works

1. A human verifies personhood with World ID (Orb).
2. The backend verifies the proof, derives a `humanId`, and signs an EIP-712
   attestation binding `humanId -> userAddress`.
3. The user signs a transaction against `VeriRegistrar` to register an agent
   subname (`<label>.veri.eth`) under that `humanId`, up to 5 agents per human.
4. The human grants/revokes scoped capabilities (ENSv2 EAC roles) per agent.
5. Every event is indexed by the subgraph and queryable by any third party.

## Running locally

### Contracts
```
cd contracts
cp .env.example .env   # fill in RPC_URL, PRIVATE_KEY, etc.
forge install
forge test
forge script script/SetupRegistry.s.sol --rpc-url $RPC_URL --broadcast
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
forge script script/Seed.s.sol --rpc-url $RPC_URL --broadcast
```

### Subgraph
```
cd subgraph
npm install
npm run codegen
npm run build
npm run deploy   # requires `graph auth --studio <key>` once
```

### Backend
```
cd veri-agent-hub-main/backend
cp .env.example .env   # fill in RPC_URL, VERI_REGISTRAR_ADDRESS, ATTESTOR_PRIVATE_KEY,
                        # SUBGRAPH_URL, WORLD_*
npm install
npm run dev             # http://localhost:8787
```

### Frontend
```
cd veri-agent-hub-main
cp .env.example .env.local   # fill in VITE_API_URL, VITE_WORLD_APP_ID
bun install
bun run dev              # http://localhost:8080
```

## Deploying

Frontend and backend deploy as two separate services from this one repo:

- **Frontend** → Vercel, with the project's Root Directory set to
  `veri-agent-hub-main/`. Set `VITE_API_URL` (pointing at the deployed backend)
  and `VITE_WORLD_APP_ID` as environment variables.
- **Backend** → any Node host (Render, Railway, Fly.io, etc. — not Vercel
  serverless, since it's a long-running Express process), with Root Directory
  set to `veri-agent-hub-main/backend/`. Set every variable from
  `backend/.env.example` as environment variables on that host.

## Known limitation — World ID verification

`WORLD_STUB_VERIFY=true` bypasses only the network call to World's verify API
in `backend/src/world.js` — everything else (nullifier replay protection,
humanId derivation, EIP-712 attestation, on-chain registration) is fully real.
This is a deliberate, disclosed workaround for a confirmed World platform gap
for developer-tier accounts (see `FEEDBACK.md` in the parent directory for the
full troubleshooting trail). Set it to `false` for a real deployment once
World grants proper API access.

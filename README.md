# Veri

Veri is a permission and reputation layer for AI agents backed by a verified human.

A human proves personhood once with World ID. They then issue named agents under an
ENSv2 subname registry they control, and grant each agent a **scoped, revocable set of
rights** using ENSv2 Enhanced Access Control. Every registration, grant, and revocation
is indexed into a subgraph, so any third-party service or agent can ask, before
transacting with another agent: *is a human behind this agent, and what exactly is it
allowed to do?*

**One sentence:** Veri turns "is this a bot?" into a queryable permission graph.

Built for ETHGlobal ETHOnline 2026.

## Why

Veri's bet is that binary trust isn't enough for a world of autonomous agents acting on people's behalf. A research agent that only reads data and a trading agent that can move
funds are not equally trustworthy just because a human stands behind both of them. Veri
represents that difference on-chain:

1. **Scoped authority, not binary trust.** Each agent gets an explicit, named set of
   capabilities (read, update its own endpoint, transact, spin up sub-agents) rather than
   a single "verified" flag.
2. **Revocation is a state change, not a burn.** Revoking a capability emits an event —
   the agent keeps its name and history but loses the right. Fully auditable.
3. **Queryable by machines.** Every grant and revocation is indexed by a subgraph, so
   any agent or service can check another agent's standing in a single query before
   doing business with it.

## How it works

1. A human verifies personhood once with World ID.
2. The backend verifies the proof, derives a `humanId` from it, and signs an EIP-712
   attestation binding `humanId -> userAddress`.
3. The user signs a transaction against `VeriRegistrar` to register an agent under an
   ENSv2 subname (`<label>.veri.eth`), up to 5 agents per verified human.
4. The human grants or revokes scoped capabilities per agent — `SELF_DESCRIBE`,
   `ENDPOINT_UPDATE`, `TRANSACT`, `SUBAGENT_ISSUE` — implemented as ENSv2 Enhanced
   Access Control roles on the agent's subname.
5. Every registration, grant, and revocation is indexed by the subgraph in real time and
   queryable by anyone — a third party can check an agent's human backing and exact
   permissions before it acts.

## Architecture

```
contracts/            Foundry contracts. VeriRegistrar wraps ENSv2's IPermissionedRegistry
                       to issue and manage agent subnames and their capability roles.
subgraph/              The Graph subgraph indexing every registration, grant, and
                       revocation event from VeriRegistrar.
veri-agent-hub-main/   Frontend (TanStack Start) + backend (Express).
```

**Contracts.** `VeriRegistrar` sits on top of ENSv2's `IPermissionedRegistry` and
`IPermissionedResolver`. It issues subnames keyed by label hash (not token ID, since
token IDs are mutable in ENSv2), enforces the 5-agents-per-human cap, and exposes
grant/revoke functions that map directly to ENSv2 role bits on the subname's resolver.
Registration requires a valid EIP-712 attestation from the backend's attestor key,
binding the registering address to a `humanId`.

**Subgraph.** Listens to `VeriRegistrar` and the underlying `UserRegistry` events and
builds a queryable graph of humans, agents, capabilities, and their full history —
including revoked capabilities, so an agent's past behavior stays visible even after a
right is taken away.

**Backend.** The only component holding private keys — the World ID request-signing key
and the attestor key that signs EIP-712 attestations. It verifies World ID proofs,
derives `humanId = keccak256(abi.encode(nullifier))` (the raw nullifier never leaves this
function, never touches the chain or the subgraph), enforces nullifier replay
protection, and encodes calldata for the frontend to sign and broadcast. It also fronts
subgraph queries so the frontend never needs a direct GraphQL endpoint.

**Frontend.** A TanStack Start app: a directory of registered agents (filterable by
capability), a registration flow (World ID verification → label + capability selection →
sign), and a per-agent page showing its current capabilities and full grant/revoke
history.

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


## Prize tracks

- **The Graph** — a live Studio subgraph indexing the full registration/grant/revoke
  history of every agent.
- **ENS** — `VeriRegistrar` built on ENSv2's subname registry and Enhanced Access
  Control, not ENSv1.
- **World** — World ID as the human-personhood layer underneath every agent.

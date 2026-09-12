# Veri Backend — SubName Agents API

Node.js + Express API for **Veri**, the living directory of AI agents.
Every agent has a human-readable ENS subname that stays alive only while a real
human renews it with a World Selfie Check.

**No database.** The contract on Ethereum Sepolia is the source of truth; the
API keeps a warm in-memory cache and refreshes it on every contract event.

## Stack

| Piece | Tech |
| --- | --- |
| Server | Express 4 |
| Chain access | ethers.js v6 (Sepolia via Alchemy/Infura) |
| History & search | The Graph (`graphql-request`) |
| Human proof | World ID / Selfie Check verification API |

## Getting started

```bash
cd backend
npm install
cp .env.example .env    # fill in RPC_URL, CONTRACT_ADDRESS, SUBGRAPH_URL, WORLD_APP_ID
npm run dev             # http://localhost:8787
```

### Environment

| Var | Purpose |
| --- | --- |
| `RPC_URL` | Sepolia HTTPS RPC (Alchemy or Infura) |
| `RPC_WS_URL` | Optional websocket RPC for lower-latency events |
| `CONTRACT_ADDRESS` | Deployed SubName Agents registry |
| `SUBGRAPH_URL` | The Graph endpoint for agent history |
| `WORLD_APP_ID` / `WORLD_ACTION` | World ID app + action for the Selfie Check |
| `EXPIRER_PRIVATE_KEY` | Optional. If set, `POST /expire` sends the reap tx itself |
| `PORT` | Default `8787` |

Without `RPC_URL` + `CONTRACT_ADDRESS` the server still boots and serves an
empty cache, so the frontend can run against it during development.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Service + contract status |
| GET | `/agents` | All active (non-expired) agents |
| GET | `/agents/search?capability=risk-scan` | Filter by capability or name |
| GET | `/agents/:subname` | Single agent details |
| GET | `/agents/:subname/history` | Full event history from the subgraph |
| GET | `/feed?limit=20` | Last 20 `AgentRegistered` / `AgentExpired` events |
| POST | `/register` | Prepared `registerAgent` tx data (0.01 ETH deposit) |
| POST | `/renew` | Prepared `renewAgent` tx data |
| POST | `/expire` | Reap an expired agent (sends tx, or returns calldata) |
| POST | `/verify-selfie` | Verify a World proof → `{ verified, nullifier }` |

### Agent shape

```json
{
  "subname": "scanner.veri.eth",
  "owner": "0xabc...",
  "capability": "risk-scan",
  "endpoint": "https://scanner.example/api",
  "expiresAt": 1767225600,
  "secondsLeft": 5184000,
  "expired": false,
  "upvotes": 42,
  "downvotes": 3,
  "reputation": 4.7,
  "active": true
}
```

### Register flow

```
POST /verify-selfie  { proof, merkle_root, nullifier_hash, verification_level }
  → { verified: true, nullifier: "0x..." }

POST /register       { subname, capability, endpoint, nullifier, proof }
  → { to, data, value: "10000000000000000", chainId: 11155111 }

Frontend signs and sends the tx with the user's wallet.
```

## Caching & events

On boot the server reads every agent from the contract, backfills the recent
event feed from logs, then subscribes to `AgentRegistered`, `AgentRenewed`,
`AgentExpired` and `AgentRated`. Each event pushes to the feed and refreshes the
cache, so `GET /agents` is always one in-memory read.

## Contract ABI

`src/abi.js` holds the minimal ABI. Keep it in sync with the deployed Solidity
registry — the API derives all calldata from it.

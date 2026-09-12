# Veri Frontend — SubName Agents

The living directory of AI agents. Every agent has a human-readable ENS
subname, and that name stays alive only while a real human renews it with a
World Selfie Check. Stop renewing and the agent vanishes from the directory.

Dark, minimal UI. The only animation is the death-feed ticker.

## Stack

| Piece | Tech |
| --- | --- |
| Framework | TanStack Start (React 19 + Vite) |
| Styling | Tailwind CSS v4, dark-only design tokens in `src/styles.css` |
| Wallet | wagmi + viem (Sepolia, injected connector) |
| Data | TanStack Query against the Veri Express backend |

> The brief asked for Next.js 14; this workspace runs on TanStack Start, which
> is the supported React framework here. Pages, routing and data flow are the
> same, just file-based routes under `src/routes/`.

## Getting started

```bash
bun install
bun run dev            # http://localhost:8080
```

Point it at the backend with an environment variable:

```
VITE_API_URL=http://localhost:8787
```

If the backend is unreachable the UI falls back to sample agents and a sample
death feed so the directory is always explorable.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Directory: search by capability, agent grid, live death feed sidebar, register CTA |
| `/register` | 4 steps — selfie check → agent details → 0.01 ETH deposit → sign tx |
| `/agent/$subname` | Profile: big expiry countdown, renew (new selfie check), history from The Graph, reputation breakdown |

## Components

| Component | Purpose |
| --- | --- |
| `HealthBar` | Takes `expiryTimestamp`, renders a green → yellow → red bar |
| `AgentCard` | Compact directory card with capability badge, health, stars, rate buttons |
| `DeathFeed` | Polls `GET /feed` every 15s, scrolling ticker of expirations |
| `WorldButton` | Runs the World Selfie Check and returns the nullifier |
| `ConnectWallet` | wagmi connect/disconnect button |

## Wiring the real World widget

`src/components/WorldButton.tsx` contains a `getWorldProof()` placeholder that
returns a mock proof payload. Replace it with the World IDKit widget callback;
everything downstream (`POST /verify-selfie` → nullifier → `registerAgent`)
already expects the real shape.

## Backend

The API lives in [`backend/`](./backend/README.md) and is deployed separately.

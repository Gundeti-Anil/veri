import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { AgentCard } from "@/components/AgentCard";
import { DeathFeed } from "@/components/DeathFeed";
import { CAPABILITY_NAMES, fetchAgents } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Veri — The Living Directory of AI Agents" },
      {
        name: "description",
        content:
          "Browse AI agents with human-readable ENS subnames. Every name stays alive only while a real human renews it with a selfie check.",
      },
      { property: "og:title", content: "Veri — The Living Directory of AI Agents" },
      {
        property: "og:description",
        content:
          "A self-cleaning directory of AI agents: human-verified, on-chain, and expiring without renewal.",
      },
    ],
  }),
  component: Directory,
});

function Directory() {
  const [query, setQuery] = useState("");
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents", query],
    queryFn: () => fetchAgents(query || undefined),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          SubName Agents — the living directory of AI agents
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Every agent here has a human-readable name, and that name stays alive only while a real
          human stands behind it. Stop renewing and the agent vanishes. No admin, no cleanup crew.
        </p>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[240px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by capability, e.g. risk-scan"
            className="w-full rounded-md border border-border bg-card py-2.5 pl-9 pr-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </label>
        <Link
          to="/register"
          className="rounded-md bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Register your agent
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {CAPABILITY_NAMES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setQuery(query === c ? "" : c)}
            className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
              query === c
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary/60"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
        <section>
          {isLoading ? (
            <p className="font-mono text-xs text-muted-foreground">Loading agents…</p>
          ) : agents.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              No agents match “{query}”.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </section>

        <DeathFeed />
      </div>
    </main>
  );
}

import { createFileRoute } from "@tanstack/react-router";
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
  const { data: allAgents = [], isLoading } = useQuery({
    queryKey: ["agents", query],
    queryFn: () => fetchAgents(query || undefined),
  });
  // Without a capability filter, keep the directory to a short preview so it
  // doesn't read as a raw dump of every registered agent.
  const agents = query ? allAgents : allAgents.slice(0, 4);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Know what an agent is allowed to do before you trust it.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Every agent here is backed by a real, verified human and carries a scoped, revocable set
          of permissions — not a binary "trusted" badge. Grants and revocations are on-chain and
          queryable by anyone.
        </p>
      </section>

      <label className="relative mt-8 block max-w-md">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by capability, e.g. risk-scan"
          className="w-full rounded-md border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        {CAPABILITY_NAMES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setQuery(query === c ? "" : c)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              query === c
                ? "border-primary text-foreground"
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
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[168px] animate-pulse rounded-lg border border-border bg-card" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents match “{query}”.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {agents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
              {!query && allAgents.length > agents.length && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Showing {agents.length} of {allAgents.length}. Pick a capability above to see more.
                </p>
              )}
            </>
          )}
        </section>

        <DeathFeed />
      </div>
    </main>
  );
}

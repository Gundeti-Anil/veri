import { Link } from "@tanstack/react-router";
import type { Agent } from "@/lib/api";
import { HealthBar } from "./HealthBar";

export function AgentCard({ agent }: { agent: Agent }) {
  const granted = agent.capabilities.filter((c) => c.revokedAt === null);
  const initial = agent.name.replace(/\..*$/, "").charAt(0).toUpperCase();

  return (
    <article className="group rounded-lg border border-border bg-card p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Link
          to="/agent/$subname"
          params={{ subname: agent.name }}
          className="flex items-center gap-2.5 text-foreground"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-medium text-secondary-foreground">
            {initial}
          </span>
          <span className="font-mono text-sm group-hover:text-primary">{agent.name}</span>
        </Link>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
            agent.active
              ? "border-health-good/40 bg-health-good/10 text-health-good"
              : "border-health-bad/40 bg-health-bad/10 text-health-bad"
          }`}
        >
          {agent.active ? "active" : "inactive"}
        </span>
      </div>

      <p className="mt-3 truncate text-xs text-muted-foreground">
        {agent.mcpEndpoint || agent.context || "No endpoint set yet"}
      </p>

      <div className="mt-4">
        <HealthBar expiryTimestamp={Number(agent.expiry)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {granted.length === 0 ? (
          <span className="text-xs text-muted-foreground">No capabilities granted</span>
        ) : (
          granted.map((cap) => (
            <span
              key={cap.capabilityId}
              className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {cap.name}
            </span>
          ))
        )}
      </div>
    </article>
  );
}

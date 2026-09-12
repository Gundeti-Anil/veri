import { Link } from "@tanstack/react-router";
import type { Agent } from "@/lib/api";
import { HealthBar } from "./HealthBar";

export function AgentCard({ agent }: { agent: Agent }) {
  const granted = agent.capabilities.filter((c) => c.revokedAt === null);

  return (
    <article className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50">
      <div className="flex items-start justify-between gap-3">
        <Link
          to="/agent/$subname"
          params={{ subname: agent.name }}
          className="font-mono text-sm text-foreground hover:text-primary"
        >
          {agent.name}
        </Link>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
            agent.active
              ? "border-health-good/40 bg-health-good/10 text-health-good"
              : "border-health-bad/40 bg-health-bad/10 text-health-bad"
          }`}
        >
          {agent.active ? "active" : "inactive"}
        </span>
      </div>

      <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
        {agent.mcpEndpoint || agent.context || "No endpoint set yet"}
      </p>

      <div className="mt-4">
        <HealthBar expiryTimestamp={Number(agent.expiry)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {granted.length === 0 ? (
          <span className="font-mono text-[10px] text-muted-foreground">No capabilities granted</span>
        ) : (
          granted.map((cap) => (
            <span
              key={cap.capabilityId}
              className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              {cap.name}
            </span>
          ))
        )}
      </div>
    </article>
  );
}

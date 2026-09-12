import { useQuery } from "@tanstack/react-query";
import { capabilityName, fetchFeed, timeAgo, type FeedEvent } from "@/lib/api";

const LABEL: Record<FeedEvent["action"], { icon: string; verb: string; tone: string }> = {
  GRANTED: { icon: "✅", verb: "granted", tone: "text-health-good" },
  REVOKED: { icon: "⛔", verb: "revoked", tone: "text-health-bad" },
};

function Row({ event }: { event: FeedEvent }) {
  const meta = LABEL[event.action];
  return (
    <li className="flex items-baseline gap-2 border-b border-border/60 py-2 last:border-0">
      <span aria-hidden>{meta.icon}</span>
      <span className="flex-1 font-mono text-[11px] leading-relaxed">
        <span className="text-foreground">{event.agent.name}</span>{" "}
        <span className={meta.tone}>{meta.verb}</span>{" "}
        <span className="text-muted-foreground">{capabilityName(event.capabilityId)}</span>{" "}
        <span className="text-muted-foreground">{timeAgo(event.timestamp)}</span>
      </span>
    </li>
  );
}

export function DeathFeed() {
  const { data = [] } = useQuery({
    queryKey: ["feed"],
    queryFn: fetchFeed,
    refetchInterval: 15_000,
  });

  return (
    <aside className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Live capability feed
        </h2>
        <span className="h-2 w-2 rounded-full bg-health-bad" aria-hidden />
      </header>

      <div className="h-[420px] overflow-hidden px-4">
        <ul className="ticker-scroll">
          {[...data, ...data].map((event, i) => (
            <Row key={`${event.id}-${i}`} event={event} />
          ))}
        </ul>
      </div>
    </aside>
  );
}

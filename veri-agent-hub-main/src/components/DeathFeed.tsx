import { useQuery } from "@tanstack/react-query";
import { capabilityName, fetchFeed, timeAgo, type FeedEvent } from "@/lib/api";

const VERB: Record<FeedEvent["action"], { text: string; tone: string }> = {
  GRANTED: { text: "granted", tone: "text-health-good" },
  REVOKED: { text: "revoked", tone: "text-health-bad" },
};

function Row({ event }: { event: FeedEvent }) {
  const meta = VERB[event.action];
  return (
    <li className="border-b border-border/60 py-3 text-sm last:border-0">
      <span className="text-foreground">{event.agent.name}</span>{" "}
      <span className={meta.tone}>{meta.text}</span>{" "}
      <span className="text-muted-foreground">{capabilityName(event.capabilityId)}</span>
      <div className="mt-0.5 text-xs text-muted-foreground">{timeAgo(event.timestamp)}</div>
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
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Recent activity</h2>
      </header>

      <div className="max-h-[420px] overflow-y-auto px-4">
        {data.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul>
            {data.map((event) => (
              <Row key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

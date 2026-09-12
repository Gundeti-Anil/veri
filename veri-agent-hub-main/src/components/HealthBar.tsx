type Props = {
  expiryTimestamp: number;
  /** Full renewal cycle length in seconds (90 days). */
  cycleSeconds?: number;
  showLabel?: boolean;
};

const NINETY_DAYS = 90 * 86400;

export function HealthBar({ expiryTimestamp, cycleSeconds = NINETY_DAYS, showLabel = true }: Props) {
  const now = Math.floor(Date.now() / 1000);
  const left = Math.max(0, expiryTimestamp - now);
  const pct = Math.min(100, Math.round((left / cycleSeconds) * 100));
  const days = Math.floor(left / 86400);

  const tone = pct > 50 ? "health-good" : pct > 20 ? "health-warn" : "health-bad";
  const barClass =
    tone === "health-good"
      ? "bg-health-good"
      : tone === "health-warn"
        ? "bg-health-warn"
        : "bg-health-bad";
  const textClass =
    tone === "health-good"
      ? "text-health-good"
      : tone === "health-warn"
        ? "text-health-warn"
        : "text-health-bad";

  return (
    <div className="w-full">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <p className={`mt-1.5 font-mono text-[11px] ${textClass}`}>
          {left === 0 ? "expired" : `${days}d until expiry`}
        </p>
      )}
    </div>
  );
}

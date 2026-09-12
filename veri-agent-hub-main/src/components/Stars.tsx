import { Star } from "lucide-react";

export function Stars({ score, size = 13 }: { score: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`Reputation ${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= Math.round(score) ? "fill-primary text-primary" : "text-muted-foreground"}
        />
      ))}
      <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{score.toFixed(1)}</span>
    </div>
  );
}

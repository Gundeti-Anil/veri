import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAccount, useSendTransaction } from "wagmi";
import { HealthBar } from "@/components/HealthBar";
import { ConnectWallet } from "@/components/ConnectWallet";
import {
  countdown,
  fetchAgent,
  fetchHistory,
  prepareRevoke,
  timeAgo,
  type Capability,
  type CapabilityEvent,
} from "@/lib/api";

export const Route = createFileRoute("/agent/$subname")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.subname} — Veri agent profile` },
      {
        name: "description",
        content: `Expiry countdown, capabilities, and event history for ${params.subname}.`,
      },
    ],
  }),
  component: AgentProfile,
});

// ── Capability badge ─────────────────────────────────────────────────────────

function CapBadge({ cap }: { cap: Capability }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
      <div>
        <span className="block font-mono text-[11px] font-medium">{cap.name}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          granted {timeAgo(Number(cap.grantedAt))}
        </span>
      </div>
      <span className="h-2 w-2 rounded-full bg-green-500" title="Active" />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function AgentProfile() {
  const { subname } = Route.useParams();
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync, isPending } = useSendTransaction();
  const [tick, setTick] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null); // capabilityId being revoked

  const { data: agent, isLoading, refetch } = useQuery({
    queryKey: ["agent", subname],
    queryFn: () => fetchAgent(subname),
    refetchInterval: 30_000,
  });
  const { data: history = [] } = useQuery({
    queryKey: ["history", subname],
    queryFn: () => fetchHistory(subname),
  });

  // Countdown ticker
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  async function revokeCapability(cap: Capability) {
    const reason = window.prompt(
      `Reason for revoking ${cap.name} from ${subname}?`,
      "Human withdrew permission"
    );
    if (reason === null) return; // cancelled

    setRevoking(cap.capabilityId);
    try {
      const label = subname.split(".")[0] ?? subname;
      const tx = await prepareRevoke(label, cap.capabilityId, reason);
      await sendTransactionAsync({
        to:    tx.to as `0x${string}`,
        data:  tx.data as `0x${string}`,
        value: BigInt(tx.value),
      });
      toast.success(`${cap.name} revoked — the agent can no longer write that ENS record`);
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Revocation failed");
    } finally {
      setRevoking(null);
    }
  }

  // ── Loading / not found ────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 font-mono text-xs text-muted-foreground">
        Loading…
      </main>
    );
  }

  if (!agent) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">{subname} is not in the directory</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have expired or retired — no human renewed it.
        </p>
        <Link to="/" className="mt-6 inline-block font-mono text-xs text-primary">
          ← back to directory
        </Link>
      </main>
    );
  }

  const secondsLeft = Math.max(0, Number(agent.expiry) - Math.floor(Date.now() / 1000));
  const isOwner     = address?.toLowerCase() === agent.agentAddress.toLowerCase();

  // ── Agent page ─────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto max-w-4xl px-6 py-10" key={tick % 2}>
      <Link to="/" className="font-mono text-[11px] text-muted-foreground hover:text-primary">
        ← directory
      </Link>

      {/* Header */}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl">{agent.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px]">
              Human-backed
            </span>
            <span className="font-mono">{agent.human.agentCount} agent{agent.human.agentCount !== 1 ? "s" : ""} from this human</span>
          </p>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2 text-center">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Capabilities</p>
          <p className="mt-0.5 font-mono text-xl">{agent.capabilities.length}</p>
        </div>
      </div>

      {/* Countdown */}
      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Time until this agent disappears
        </p>
        <p
          className={`mt-2 font-mono text-3xl sm:text-4xl ${
            secondsLeft > 30 * 86400
              ? "text-health-good"
              : secondsLeft > 7 * 86400
                ? "text-health-warn"
                : "text-health-bad"
          }`}
        >
          {countdown(secondsLeft)}
        </p>
        <div className="mt-4">
          <HealthBar expiryTimestamp={Number(agent.expiry)} showLabel={false} />
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">

        {/* Capabilities */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Active capabilities
          </h2>

          {agent.capabilities.length === 0 ? (
            <p className="mt-4 font-mono text-[11px] text-muted-foreground">No capabilities granted.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {agent.capabilities.map((cap) => (
                <div key={cap.capabilityId} className="flex items-center gap-2">
                  <div className="flex-1">
                    <CapBadge cap={cap} />
                  </div>
                  {isConnected && isOwner && (
                    <button
                      type="button"
                      onClick={() => revokeCapability(cap)}
                      disabled={isPending && revoking === cap.capabilityId}
                      title="Revoke this capability"
                      className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-red-500 hover:text-red-500 disabled:opacity-50"
                    >
                      {revoking === cap.capabilityId ? "…" : "Revoke"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!isConnected && (
            <div className="mt-4">
              <ConnectWallet />
            </div>
          )}
        </section>

        {/* Details + history */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Details
          </h2>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Agent address</dt>
              <dd className="truncate font-mono">
                {agent.agentAddress.slice(0, 8)}…{agent.agentAddress.slice(-6)}
              </dd>
            </div>
            {agent.mcpEndpoint && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">MCP endpoint</dt>
                <dd className="truncate font-mono text-[11px]">{agent.mcpEndpoint}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="font-mono">
                {new Date(Number(agent.expiry) * 1000).toLocaleDateString()}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd className={`font-mono ${agent.active ? "text-green-500" : "text-red-500"}`}>
                {agent.active ? "active" : "retired"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Issued</dt>
              <dd className="font-mono">{timeAgo(Number(agent.issuedAt))}</dd>
            </div>
          </dl>

          {agent.context && (
            <>
              <h3 className="mt-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Context
              </h3>
              <p className="mt-2 text-[11px] text-muted-foreground">{agent.context}</p>
            </>
          )}

          <h3 className="mt-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Capability history
          </h3>
          <ul className="mt-3 space-y-2">
            {(history as CapabilityEvent[]).slice(0, 10).map((ev) => (
              <li
                key={ev.id}
                className="flex items-baseline justify-between gap-3 font-mono text-[11px]"
              >
                <span
                  className={ev.action === "REVOKED" ? "text-red-500" : "text-green-500"}
                >
                  {ev.action}
                </span>
                <span className="text-muted-foreground">{timeAgo(Number(ev.timestamp))}</span>
              </li>
            ))}
            {history.length === 0 && (
              <li className="font-mono text-[11px] text-muted-foreground">No events yet.</li>
            )}
          </ul>
        </section>

      </div>
    </main>
  );
}

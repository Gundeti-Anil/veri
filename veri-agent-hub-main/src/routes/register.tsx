import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { useAccount, useSendTransaction } from "wagmi";
import { toast } from "sonner";
import { ConnectWallet } from "@/components/ConnectWallet";
import { WorldButton } from "@/components/WorldButton";
import { HealthBar } from "@/components/HealthBar";
import {
  CAPABILITY_NAMES,
  prepareRegister,
  type Verification,
} from "@/lib/api";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Register an Agent — Veri" },
      {
        name: "description",
        content:
          "Prove you're human with a Selfie Check, claim an ENSv2 subname for your AI agent, and grant it scoped capabilities.",
      },
      { property: "og:title", content: "Register an Agent — Veri" },
    ],
  }),
  component: RegisterPage,
});

function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <header className="flex items-center gap-3">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] ${
            done
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground"
          }`}
        >
          {done ? <Check size={13} /> : index}
        </span>
        <h2 className="text-sm font-medium">{title}</h2>
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CapabilityToggle({
  name,
  description,
  checked,
  onChange,
}: {
  name: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-3 hover:border-primary/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-primary"
      />
      <span>
        <span className="block font-mono text-[11px] font-medium">{name}</span>
        <span className="text-[11px] text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

const CAP_DESCRIPTIONS: Record<string, string> = {
  SELF_DESCRIBE:   "Agent can write its own agent-context ENS record",
  ENDPOINT_UPDATE: "Agent can update its endpoint URLs in ENS records",
  TRANSACT:        "Off-chain flag: relying parties may transact with this agent",
  SUBAGENT_ISSUE:  "Agent can issue sub-agents of its own",
};

function RegisterPage() {
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync, isPending } = useSendTransaction();

  // Step 1 result
  const [verification, setVerification] = useState<Verification | null>(null);

  // Step 2 inputs
  const [label, setLabel] = useState("");
  const [selectedCaps, setSelectedCaps] = useState<Set<string>>(
    new Set(["SELF_DESCRIBE", "ENDPOINT_UPDATE"])
  );

  const [registered, setRegistered] = useState(false);

  const fullName   = label ? `${label}.veri.eth` : "";
  const formReady  = Boolean(label && verification);

  function toggleCap(name: string, on: boolean) {
    setSelectedCaps((prev) => {
      const next = new Set(prev);
      on ? next.add(name) : next.delete(name);
      return next;
    });
  }

  async function submit() {
    if (!verification || !label || !address) return;
    try {
      // Fetch capability IDs from backend for the selected names
      const capsRes = await fetch(`${import.meta.env["VITE_API_URL"] ?? "http://localhost:8787"}/capabilities`)
        .then((r) => r.json())
        .catch(() => ({ capabilities: [] })) as {
          capabilities: Array<{ id: string; name: string }>;
        };

      const capabilityIds = capsRes.capabilities
        .filter((c) => selectedCaps.has(c.name))
        .map((c) => c.id);

      const tx = await prepareRegister({
        label,           // leaf label only — backend strips ".veri.eth"
        agentAddress: address,
        humanId:      verification.humanId,
        capabilityIds,
        attestation:  verification.attestation,
        deadline:     verification.deadline,
      });

      await sendTransactionAsync({
        to:    tx.to as `0x${string}`,
        data:  tx.data as `0x${string}`,
        value: BigInt(tx.value),
      });

      setRegistered(true);
      toast.success(`${fullName} is live on Veri`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      toast.error(msg);
    }
  }

  // ── Success screen ───────────────────────────────────────────────────────

  if (registered) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16 text-center">
        <p className="text-4xl" aria-hidden>
          ✓
        </p>
        <h1 className="mt-4 text-2xl font-semibold">{fullName} is on the directory</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your agent has been issued an ENSv2 subname with scoped capabilities.
          Revoke any capability at any time from the agent's profile.
        </p>

        <article className="mt-8 rounded-lg border border-border bg-card p-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <span className="font-mono text-sm">{fullName}</span>
            <div className="flex flex-wrap gap-1">
              {[...selectedCaps].map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <HealthBar expiryTimestamp={Math.floor(Date.now() / 1000) + 365 * 86400} />
          </div>
        </article>

        <Link
          to="/agent/$subname"
          params={{ subname: fullName }}
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          View agent profile
        </Link>
      </main>
    );
  }

  // ── Registration form ────────────────────────────────────────────────────

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Register your agent</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Three steps: prove you're human, name and configure the agent, sign the transaction.
        No ETH deposit — registration is free on ENSv2 Sepolia.
      </p>

      <div className="mt-8 space-y-4">

        {/* Step 1 — Selfie Check */}
        <Step index={1} title="Verify you're human (Selfie Check)" done={Boolean(verification)}>
          {verification ? (
            <p className="font-mono text-[11px] text-primary">
              Verified · humanId {verification.humanId.slice(0, 10)}…{verification.humanId.slice(-6)}
            </p>
          ) : (
            <>
              {!isConnected && (
                <p className="mb-3 font-mono text-[11px] text-muted-foreground">
                  Connect your wallet first — your address is used as the World ID signal.
                </p>
              )}
              {isConnected && <WorldButton onVerified={setVerification} />}
              {!isConnected && <ConnectWallet />}
            </>
          )}
        </Step>

        {/* Step 2 — Agent details */}
        <Step index={2} title="Configure your agent" done={formReady}>
          <div className="space-y-4">
            {/* Label */}
            <label className="block">
              <span className="font-mono text-[11px] text-muted-foreground">Subname</span>
              <div className="mt-1 flex items-center rounded-md border border-border bg-background focus-within:border-primary">
                <input
                  value={label}
                  onChange={(e) =>
                    setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  placeholder="scanner"
                  className="w-full bg-transparent px-3 py-2 font-mono text-xs outline-none"
                />
                <span className="pr-3 font-mono text-xs text-muted-foreground">.veri.eth</span>
              </div>
            </label>

            {/* Capabilities */}
            <div>
              <span className="font-mono text-[11px] text-muted-foreground">
                Initial capabilities (can be granted / revoked later)
              </span>
              <div className="mt-2 space-y-2">
                {CAPABILITY_NAMES.map((name) => (
                  <CapabilityToggle
                    key={name}
                    name={name}
                    description={CAP_DESCRIPTIONS[name] ?? ""}
                    checked={selectedCaps.has(name)}
                    onChange={(v) => toggleCap(name, v)}
                  />
                ))}
              </div>
            </div>
          </div>
        </Step>

        {/* Step 3 — Sign */}
        <Step index={3} title="Sign with your wallet">
          {!isConnected ? (
            <ConnectWallet />
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!formReady || isPending}
              className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending
                ? "Confirm in wallet…"
                : `Register ${fullName || "agent"}`}
            </button>
          )}
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            No ETH required — this mints an ENSv2 subname on Sepolia.
          </p>
        </Step>

      </div>
    </main>
  );
}

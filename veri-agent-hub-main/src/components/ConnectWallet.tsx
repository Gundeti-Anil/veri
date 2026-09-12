import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [menuOpen, setMenuOpen] = useState(false);
  // EIP-6963 wallet discovery only runs in the browser, so `connectors` differs
  // between the server render (empty) and the client after hydration. Gate the
  // connector-count-dependent markup behind a mounted flag so the server and
  // first client render stay identical, avoiding a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className="rounded-md border border-border px-3 py-2 font-mono text-xs text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }

  const availableConnectors = mounted ? connectors : [];

  return (
    <div className="relative">
      <button
        type="button"
        disabled={isPending || (mounted && availableConnectors.length === 0)}
        onClick={() => {
          if (availableConnectors.length > 1) {
            setMenuOpen((v) => !v);
          } else if (availableConnectors.length === 1) {
            connect({ connector: availableConnectors[0]! });
          }
        }}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
      >
        <Wallet size={14} />
        {isPending
          ? "Connecting…"
          : mounted && availableConnectors.length === 0
            ? "No wallet found"
            : "Connect wallet"}
      </button>
      {menuOpen && availableConnectors.length > 1 && (
        <div className="absolute right-0 top-full z-10 mt-1 min-w-[160px] rounded-md border border-border bg-card p-1 shadow-md">
          {availableConnectors.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              onClick={() => {
                setMenuOpen(false);
                connect({ connector });
              }}
              className="block w-full rounded-sm px-3 py-2 text-left text-xs text-foreground hover:bg-accent"
            >
              {connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

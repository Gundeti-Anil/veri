import { Link } from "@tanstack/react-router";
import { ConnectWallet } from "./ConnectWallet";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight text-foreground">veri</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/register"
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Register your agent
          </Link>
          <ConnectWallet />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

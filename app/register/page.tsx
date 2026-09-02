import type { Metadata } from "next";
import Link from "next/link";
import { ListAgentForm } from "@/components/register-agent-form";
import { requireErc8004Config } from "@/lib/erc8004";

export const metadata: Metadata = { title: "List an agent — The Sidekick" };

export default function RegisterAgentPage() {
  let registry = "";
  try {
    registry = requireErc8004Config().identityRegistry;
  } catch {
    registry = "(config missing)";
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="font-mono text-xs uppercase tracking-[0.2em] text-faint hover:text-foreground">
          ← Home
        </Link>
        <p className="mt-6 mb-2 font-mono text-xs uppercase tracking-[0.25em] text-faint">
          AgentListing · ERC-8004 registry
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">List an agent</h1>
        <p className="mt-3 text-muted">
          Registers a BNB agent identity on ERC-8004 if needed, then bonds the listing with a
          0.01 tBNB deposit on AgentListing. Your connected wallet signs the bond transaction —
          the server never holds your key.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded border border-border bg-surface px-4 py-2">
          <span className="text-xs uppercase tracking-[0.18em] text-faint">registry</span>
          <span className="font-mono text-xs tabular text-accent">{registry}</span>
        </div>

        <div className="mt-8">
          <ListAgentForm />
        </div>
      </div>
    </main>
  );
}

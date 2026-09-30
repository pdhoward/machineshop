import { Database } from "lucide-react";

/** Shown when the catalog isn't connected yet (no MONGODB_URI). */
export function SetupNotice() {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-dashed border-line bg-panel p-8 text-center">
      <Database className="mx-auto size-8 text-accent" />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Connect the catalog</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-fog">
        The store is running, but it has no product database yet. Set <code className="font-mono text-ink">MONGODB_URI</code> (and optionally{" "}
        <code className="font-mono text-ink">MONGODB_DB</code>, <code className="font-mono text-ink">MONGODB_COLLECTION</code>), then restart.
        See <code className="font-mono text-ink">.env.example</code>.
      </p>
    </div>
  );
}

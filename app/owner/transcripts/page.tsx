import type { Metadata } from "next";

import { OwnerTranscripts } from "@/components/owner-transcripts";
import { voiceConfigured } from "@/lib/voice";

// Private: never indexed or followed by search engines.
export const metadata: Metadata = {
  title: "Saved calls",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

// Check the voice settings on each request, not once at build.
export const dynamic = "force-dynamic";

export default function OwnerTranscriptsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Saved calls</h1>
      <p className="mt-1 text-[14px] text-fog">Talk mode transcripts from the last 30 days. They delete themselves after that.</p>
      {voiceConfigured() ? <OwnerTranscripts /> : <p className="mt-8 text-fog">Talk isn&apos;t set up yet, so there are no saved calls.</p>}
    </main>
  );
}

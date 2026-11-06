import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { Assistant } from "@/components/assistant";
import { ModeBar } from "@/components/cradle/mode-bar";
import { Header } from "@/components/header";
import { cradleConfigured } from "@/lib/cradle/book";
import { compiledRules } from "@/lib/cradle/compile";
import { catalogConfigured } from "@/lib/catalog";
import { voiceConfigured } from "@/lib/voice";

/** Cradle mode proves new rules after a response is sent (the conformance gate); give it time. */
export const maxDuration = 300;

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Machine Shop", template: "%s · Machine Shop" },
  description: "Ten thousand things for the home and workshop, and an assistant that knows every one of them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="font-sans">
        <Header />
        <ModeBar />
        {children}
        <footer className="mx-auto mt-20 max-w-7xl border-t border-line px-4 py-8 text-xs text-mist sm:px-6">
          <FooterNotice />
        </footer>
        <Assistant enabled={!!process.env.ANTHROPIC_API_KEY} voice={voiceConfigured() && catalogConfigured()} />
      </body>
    </html>
  );
}

/** The footer line: from the policy book in cradle mode, else the original text. */
async function FooterNotice() {
  if (cradleConfigured()) {
    const { projection, compiled } = await compiledRules();
    if (compiled) return <>{projection.notices.footer}</>;
  }
  return <>Machine Shop is a test store: payments use Stripe test mode, with no real charges. Product data from a 2021 public catalog crawl.</>;
}

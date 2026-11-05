import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const fraunces = Fraunces({ variable: "--font-display", subsets: ["latin"], weight: ["600", "700"] });
const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    template: "%s · ChamaPot",
    default: "ChamaPot · The AI treasurer for your chama",
  },
  description:
    "ChamaPot runs a chama's money on PayPal: invoices for every contribution, verified webhooks, a Claude treasurer agent and two-official payouts.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBF7F0" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1714" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-[10px] focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-card"
        >
          Skip to content
        </a>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}

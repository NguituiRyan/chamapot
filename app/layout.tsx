import type { Metadata } from "next";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}

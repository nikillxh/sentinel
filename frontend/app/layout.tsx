import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sentinel – Policy-Governed DeFi Wallet",
  description: "AI-driven DeFi execution with on-chain policy enforcement",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-sentinel-bg text-gray-200 antialiased">
        {children}
      </body>
    </html>
  );
}

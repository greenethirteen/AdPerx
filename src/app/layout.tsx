import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AdPerx — Perplexity for Advertising",
  description: "Search award-winning advertising work with fast filters and previews."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

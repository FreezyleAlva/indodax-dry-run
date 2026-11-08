// src/app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Freezyle Trend Breakout Crypto - Dry Run Indodax",
  description: "Dashboard bot dry run Indodax: portofolio, kinerja, biaya, paritas sinyal, operasional.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}

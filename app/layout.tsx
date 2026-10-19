import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jane Wealth Hub",
  description:
    "Consolidated net worth, asset allocation, and long-term wealth planning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

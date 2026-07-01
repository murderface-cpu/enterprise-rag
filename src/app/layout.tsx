import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scalable Enterprise RAG",
  description:
    "Production-grade Retrieval-Augmented Generation system with Gemini, Upstash Vector, and hybrid retrieval.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
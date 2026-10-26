import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Thai } from "next/font/google";

import { WorkspaceProvider } from "@/context/WorkspaceContext";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  variable: "--font-noto-thai",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Sloth · AI Workspace & RAG Knowledge Base",
  description:
    "A minimalist luxury AI workspace with a hybrid RAG knowledge base, powered by the Kilo Code AI Gateway.",
  applicationName: "Sloth",
};

export const viewport: Viewport = {
  themeColor: "#FAFAFA",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${notoThai.variable}`}>
      <body className="min-h-screen bg-alabaster font-sans">
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </body>
    </html>
  );
}

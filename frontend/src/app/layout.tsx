import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OR-Nav — Voice-First CVOR Clinical Assistant",
  description: "HIPAA-compliant, voice-first Cardiovascular Operating Room navigation & preference assistant",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "OR-Nav",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full antialiased" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} h-full bg-[#090d16] text-slate-100`}>
        {children}
      </body>
    </html>
  );
}

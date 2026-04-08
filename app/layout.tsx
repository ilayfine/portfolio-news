import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import NavLink from "./components/NavLink";
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
  title: "Portfolio News",
  description: "AI-summarized news for your stock portfolio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-50 border-b border-neutral-800/60 bg-[#09090b]/80 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-14">
            <span className="text-base font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Portfolio News
            </span>
            <nav className="flex items-center gap-6">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/portfolio">Portfolio</NavLink>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}

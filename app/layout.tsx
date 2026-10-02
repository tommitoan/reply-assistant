import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import AppHeader from "@/components/AppHeader";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

// The vietnamese subset matters: the writer types Vietnamese all day.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// What the assistant writes, and the page titles, are set in a serif.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

export const metadata: Metadata = {
  title: "Reply Assistant",
  description: "Drafts English replies in your own voice, from a Vietnamese idea or a pasted chat.",
};

// Applies the persisted/system theme to <html> before hydration so there is
// no flash of the wrong theme. Runs as a blocking inline script since it
// must execute before the rest of the page paints.
const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored === "dark" || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <ThemeToggle />
        <AppHeader />
        {children}
      </body>
    </html>
  );
}

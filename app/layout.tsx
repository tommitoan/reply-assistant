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
  description: "Viết bản nháp trả lời tiếng Anh theo giọng của bạn, từ một ý tiếng Việt hoặc đoạn chat dán vào.",
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
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="h-dvh overflow-hidden">
        <ThemeToggle />
        {/* The page is a fixed-height shell: the top bar stays, and each page scrolls (or, for the
            chat, manages its own scrolling) inside the remaining space. */}
        <div className="flex h-full flex-col">
          <AppHeader />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </body>
    </html>
  );
}

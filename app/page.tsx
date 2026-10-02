import type { Metadata } from "next";
import ReplyWorkspace from "@/components/reply/ReplyWorkspace";

export const metadata: Metadata = { title: "Reply Assistant" };

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <ReplyWorkspace />
    </main>
  );
}

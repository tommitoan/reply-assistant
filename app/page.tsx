import type { Metadata } from "next";
import ReplyWorkspace from "@/components/reply/ReplyWorkspace";

export const metadata: Metadata = { title: "Reply Assistant" };

export default function HomePage() {
  return (
    <main className="h-full">
      <ReplyWorkspace />
    </main>
  );
}

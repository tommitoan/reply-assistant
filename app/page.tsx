import { redirect } from "next/navigation";

// The assistant is the whole app.
export default function Home() {
  redirect("/reply");
}

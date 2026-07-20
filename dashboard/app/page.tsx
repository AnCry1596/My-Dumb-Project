import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LogsView from "./logs-view";

// Node.js middleware (proxy.ts) isn't supported on Cloudflare Workers, so auth
// gating for pages happens here instead — a Server Component check per protected
// page, same pattern NextAuth recommends when middleware-based gating isn't available.
export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <LogsView />;
}

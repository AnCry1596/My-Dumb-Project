import { redirect } from "next/navigation";
import { auth } from "@/auth";
import DevicesView from "./devices-view";

// See app/page.tsx for why this guard lives here instead of proxy.ts.
export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <DevicesView />;
}

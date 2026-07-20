"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  if (status !== "authenticated" || pathname === "/login" || pathname === "/signup") return null;

  return (
    <nav className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <div className="flex gap-4 text-sm font-medium">
        <Link href="/" className="text-black dark:text-zinc-50">Logs</Link>
        <Link href="/devices" className="text-black dark:text-zinc-50">Devices</Link>
      </div>
      <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        <span>{session.user?.email}</span>
        <button onClick={() => signOut({ redirectTo: "/login" })} className="underline">
          Sign out
        </button>
      </div>
    </nav>
  );
}

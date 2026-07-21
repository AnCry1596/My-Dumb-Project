"use client";

import { useEffect, useState } from "react";
import type { DoorLog } from "@/lib/mongodb";
import NotificationPrompt from "./notification-prompt";

const EVENT_LABEL: Record<string, string> = {
  DOOR_OPEN: "Door opened",
  DOOR_CLOSE: "Door closed",
  LOCK_OPEN: "Lock unlocked (remote)",
  LOCK_CLOSE: "Lock locked (remote)",
  SYSTEM_ON: "System alarmed",
  SYSTEM_OFF: "System disalarmed",
};

const PAGE_SIZE = 25;

export default function LogsView() {
  const [logs, setLogs] = useState<DoorLog[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/logs?page=${page}&pageSize=${PAGE_SIZE}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setLogs(data.logs);
          setTotal(data.total);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }

    load();
    // Only auto-refresh while viewing the newest page — jumping the list out from
    // under someone reading page 2+ would be disorienting.
    const id = page === 1 ? setInterval(load, 5000) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col py-12 px-6">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-1">
          SmartDoor Logs
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          {page === 1 ? "Live door/lock/system events, refreshing every 5s." : `Page ${page} of ${totalPages}.`}
        </p>

        <NotificationPrompt />

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">
            Failed to load logs: {error}
          </p>
        )}

        {logs === null && !error && (
          <p className="text-sm text-zinc-500">Loading...</p>
        )}

        {logs !== null && logs.length === 0 && (
          <p className="text-sm text-zinc-500">No events logged yet.</p>
        )}

        <ul className="flex flex-col gap-2">
          {logs?.map((log) => (
            <li
              key={log._id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
                log.alarm
                  ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              }`}
            >
              <div className="flex flex-col">
                <span className="font-medium text-black dark:text-zinc-50">
                  {EVENT_LABEL[log.event] ?? log.event}
                  {log.alarm && (
                    <span className="ml-2 text-red-600 dark:text-red-400">
                      ALARM
                    </span>
                  )}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {log.deviceName}
                </span>
              </div>
              <time className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(log.time).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>

        {total > PAGE_SIZE && (
          <div className="mt-6 flex items-center justify-center gap-4 text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              Previous
            </button>
            <span className="text-zinc-500 dark:text-zinc-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

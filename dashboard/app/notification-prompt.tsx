"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function NotificationPrompt() {
  const [status, setStatus] = useState<"unsupported" | "denied" | "subscribed" | "available">(
    "available"
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub) setStatus("subscribed");
    });
  }, []);

  async function subscribe() {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setStatus("unsupported");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("denied");
      return;
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });

    setStatus("subscribed");
  }

  if (status === "subscribed" || status === "unsupported") return null;

  return (
    <div className="mb-6 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950">
      <span>
        {status === "denied"
          ? "Notifications are blocked in your browser settings — enable them to get alarm alerts."
          : "Turn on notifications to get alerted when a door opens while the system is armed."}
      </span>
      {status === "available" && (
        <button onClick={subscribe} className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-black">
          Enable
        </button>
      )}
    </div>
  );
}

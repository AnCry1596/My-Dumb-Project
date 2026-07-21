"use client";

import { useEffect, useState } from "react";
import type { DeviceDoc } from "@/lib/mongodb";
import DeviceCard from "./device-card";

type DeviceWithState = DeviceDoc & { currentlyArmed: boolean };

export default function DevicesView() {
  const [devices, setDevices] = useState<DeviceWithState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingDeviceObjectId, setPendingDeviceObjectId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DeviceWithState[] = await res.json();
      setDevices(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 3000); // ponytail: poll instead of websockets, catches pairing + schedule-driven state changes
    return () => clearInterval(id);
  }, []);

  // Once the device we're waiting on actually pairs (gets a deviceId), the
  // pairing-code banner has served its purpose — hide it. Runs whenever a poll
  // brings in fresh `devices`, instead of living inside the interval's `load`
  // closure (which would keep seeing pendingDeviceObjectId as it was at mount).
  useEffect(() => {
    if (!pendingDeviceObjectId || !devices) return;
    const paired = devices.find((d) => String(d._id) === pendingDeviceObjectId)?.deviceId;
    if (paired) {
      setPendingCode(null);
      setPendingDeviceObjectId(null);
    }
  }, [devices, pendingDeviceObjectId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName || "New device" }),
    });
    if (!res.ok) {
      setError("Failed to create device");
      return;
    }
    const { claimCode, deviceObjectId } = await res.json();
    setPendingCode(claimCode);
    setPendingDeviceObjectId(deviceObjectId);
    setNewName("");
    load();
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col py-12 px-6">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-1">Devices</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          Add a device, then enter the pairing code on the device&apos;s WiFi setup page.
        </p>

        <form onSubmit={handleAdd} className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Device name (e.g. Front Door)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="submit"
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Add device
          </button>
        </form>

        {pendingCode && (
          <div className="mb-6 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900 dark:bg-blue-950">
            Pairing code: <span className="font-mono text-lg font-bold">{pendingCode}</span>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Connect to the device&apos;s &quot;SmartDoor-Setup&quot; WiFi network, open the setup
              page, enter your home WiFi and this code.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}
        {devices === null && !error && <p className="text-sm text-zinc-500">Loading...</p>}
        {devices !== null && devices.length === 0 && (
          <p className="text-sm text-zinc-500">No devices yet.</p>
        )}

        <ul className="flex flex-col gap-2">
          {devices?.map((d) => (
            <DeviceCard key={String(d._id)} device={d} onChanged={load} />
          ))}
        </ul>
      </main>
    </div>
  );
}

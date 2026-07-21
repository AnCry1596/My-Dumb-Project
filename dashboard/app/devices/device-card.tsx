"use client";

import { useState } from "react";
import type { DeviceDoc, ScheduleRule } from "@/lib/mongodb";

type DeviceWithState = DeviceDoc & { currentlyArmed: boolean; online: boolean };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function patchDevice(id: string, body: object) {
  const res = await fetch(`/api/devices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export default function DeviceCard({
  device,
  onChanged,
}: {
  device: DeviceWithState;
  onChanged: () => void;
}) {
  const id = String(device._id);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [overrideMinutes, setOverrideMinutes] = useState(60);
  const [rules, setRules] = useState<ScheduleRule[]>(device.scheduleRules ?? []);
  const [busy, setBusy] = useState(false);

  const hasOverride = device.tempOverrideUntil && new Date(device.tempOverrideUntil) > new Date();

  async function toggleArmed() {
    setBusy(true);
    await patchDevice(id, { armed: !device.armed });
    setBusy(false);
    onChanged();
  }

  async function disarmFor(minutes: number) {
    setBusy(true);
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    await patchDevice(id, { overrideArmed: false, overrideUntil: until });
    setBusy(false);
    onChanged();
  }

  async function clearOverride() {
    setBusy(true);
    await patchDevice(id, { clearOverride: true });
    setBusy(false);
    onChanged();
  }

  async function removeDevice() {
    if (!confirm(`Remove "${device.name}"? This can't be undone.`)) return;
    setBusy(true);
    await fetch(`/api/devices/${id}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  }

  async function saveSchedule() {
    setBusy(true);
    await patchDevice(id, {
      scheduleRules: rules,
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    setBusy(false);
    onChanged();
  }

  function addRule() {
    setRules([...rules, { day: 1, start: "09:00", end: "17:00" }]);
  }

  function updateRule(i: number, patch: Partial<ScheduleRule>) {
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRule(i: number) {
    setRules(rules.filter((_, idx) => idx !== i));
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        {editingName !== null ? (
          <div className="flex flex-1 gap-2">
            <input
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              onClick={async () => {
                await patchDevice(id, { name: editingName });
                setEditingName(null);
                onChanged();
              }}
              className="text-sm underline"
            >
              Save
            </button>
            <button onClick={() => setEditingName(null)} className="text-sm text-zinc-500">
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col">
              <span className="font-medium text-black dark:text-zinc-50">{device.name}</span>
              <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {device.deviceId ? (
                  <>
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        device.online ? "bg-green-500" : "bg-zinc-400"
                      }`}
                    />
                    {device.deviceId} · {device.online ? "Online" : "Offline"}
                  </>
                ) : (
                  "Waiting for device to pair..."
                )}
              </span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditingName(device.name)} className="text-sm underline">
                Rename
              </button>
              <button onClick={removeDevice} disabled={busy} className="text-sm text-red-600 underline disabled:opacity-50 dark:text-red-400">
                Remove
              </button>
            </div>
          </>
        )}
      </div>

      {device.deviceId && (
        <>
          <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  device.currentlyArmed ? "bg-red-500" : "bg-zinc-400"
                }`}
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {device.currentlyArmed ? "Armed" : "Disarmed"}
                {hasOverride &&
                  ` until ${new Date(device.tempOverrideUntil!).toLocaleTimeString()}`}
              </span>
            </div>
            <button
              onClick={toggleArmed}
              disabled={busy}
              className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {device.armed ? "Disarm" : "Arm"} (base state)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">Quick disarm:</span>
            {[30, 60, 240].map((m) => (
              <button
                key={m}
                onClick={() => disarmFor(m)}
                disabled={busy}
                className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50 dark:border-zinc-700"
              >
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
            <input
              type="number"
              min={1}
              value={overrideMinutes}
              onChange={(e) => setOverrideMinutes(Number(e.target.value))}
              className="w-16 rounded border border-zinc-300 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              onClick={() => disarmFor(overrideMinutes)}
              disabled={busy}
              className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50 dark:border-zinc-700"
            >
              min
            </button>
            {hasOverride && (
              <button onClick={clearOverride} disabled={busy} className="underline">
                Clear override
              </button>
            )}
          </div>

          <button
            onClick={() => setShowSchedule((s) => !s)}
            className="self-start text-xs underline text-zinc-500 dark:text-zinc-400"
          >
            {showSchedule ? "Hide" : "Edit"} weekly schedule ({rules.length} rule
            {rules.length === 1 ? "" : "s"})
          </button>

          {showSchedule && (
            <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Device disarms automatically during these recurring windows (your local time).
              </p>
              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <select
                    value={rule.day}
                    onChange={(e) => updateRule(i, { day: Number(e.target.value) })}
                    className="rounded border border-zinc-300 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    {DAYS.map((d, idx) => (
                      <option key={idx} value={idx}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={rule.start}
                    onChange={(e) => updateRule(i, { start: e.target.value })}
                    className="rounded border border-zinc-300 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <span>to</span>
                  <input
                    type="time"
                    value={rule.end}
                    onChange={(e) => updateRule(i, { end: e.target.value })}
                    className="rounded border border-zinc-300 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <button onClick={() => removeRule(i)} className="text-red-600 dark:text-red-400">
                    Remove
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={addRule} className="text-xs underline">
                  + Add window
                </button>
                <button
                  onClick={saveSchedule}
                  disabled={busy}
                  className="rounded bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                >
                  Save schedule
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </li>
  );
}

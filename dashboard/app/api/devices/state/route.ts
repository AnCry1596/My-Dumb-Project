import { NextResponse } from "next/server";
import {
  getDeviceByDeviceId,
  verifyDeviceToken,
  computeAlarmedState,
  markDeviceSeen,
  isDeviceOnline,
} from "@/lib/mongodb";
import { notifyOwner } from "@/lib/push";

// Polled by the ESP32 every few seconds instead of listening on MQTT. Returns the
// device's current alarmed/disalarmed state (already resolved from manual flag, one-off
// override, and recurring schedule) plus server time, since the ESP32 has no RTC of
// its own and only gets wall-clock time via NTP at boot.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId") ?? "";
  const token = request.headers.get("x-device-token") ?? "";

  const authorized = await verifyDeviceToken(deviceId, token);
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const device = await getDeviceByDeviceId(deviceId);
  if (!device) return NextResponse.json({ error: "not found" }, { status: 404 });

  // There's no cron here — offline is only ever noticed retroactively, on whatever
  // poll finally lands after a gap. Read the *previous* lastSeenAt before overwriting
  // it: if the device was already considered offline, this poll is a reconnect.
  const wasOffline = !isDeviceOnline(device);
  await markDeviceSeen(deviceId);

  if (wasOffline && device.lastSeenAt) {
    const offlineMinutes = Math.round((Date.now() - new Date(device.lastSeenAt).getTime()) / 60_000);
    await notifyOwner(device.ownerId, {
      title: `${device.name} back online`,
      body: offlineMinutes >= 1 ? `Was offline for ~${offlineMinutes}m.` : "Reconnected.",
    });
  }

  return NextResponse.json({
    alarmed: computeAlarmedState(device),
    serverTime: new Date().toISOString(),
  });
}

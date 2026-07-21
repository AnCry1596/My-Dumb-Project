import { NextResponse } from "next/server";
import { getNewlyOfflineDevices, markDeviceOfflineNotified } from "@/lib/mongodb";
import { notifyOwner } from "@/lib/push";

// Vercel Cron hits this on a schedule (see vercel.json) — the device itself has no way
// to tell us it's about to go offline, so this is the only way to notice in real time,
// as opposed to /api/devices/state's retroactive "back online" notice.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const devices = await getNewlyOfflineDevices();
  await Promise.all(
    devices.map(async (device) => {
      await markDeviceOfflineNotified(device.deviceId);
      await notifyOwner(device.ownerId, {
        title: `${device.name} offline`,
        body: "Device stopped responding — check its power and WiFi.",
      });
    })
  );

  return NextResponse.json({ notified: devices.length });
}

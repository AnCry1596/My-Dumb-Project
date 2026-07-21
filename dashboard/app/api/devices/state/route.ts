import { NextResponse } from "next/server";
import { getDeviceByDeviceId, verifyDeviceToken, computeArmedState, markDeviceSeen } from "@/lib/mongodb";

// Polled by the ESP32 every few seconds instead of listening on MQTT. Returns the
// device's current armed/disarmed state (already resolved from manual flag, one-off
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

  await markDeviceSeen(deviceId);

  return NextResponse.json({
    armed: computeArmedState(device),
    serverTime: new Date().toISOString(),
  });
}

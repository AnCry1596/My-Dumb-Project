import { NextResponse } from "next/server";
import { insertLog, verifyDeviceToken, getDeviceByDeviceId, computeArmedState } from "@/lib/mongodb";
import { notifyOwner } from "@/lib/push";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.event !== "string" || typeof body.deviceId !== "string") {
    return NextResponse.json({ error: "event and deviceId are required" }, { status: 400 });
  }

  const token = request.headers.get("x-device-token") ?? "";
  const authorized = await verifyDeviceToken(body.deviceId, token);
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const device = await getDeviceByDeviceId(body.deviceId);
  // The server's own schedule/override state is the authority on whether this event
  // is alarm-worthy — not whatever the device happened to report — so a door open
  // during a scheduled disarm window always logs, but never notifies.
  const alarm = body.event === "DOOR_OPEN" && !!device && computeArmedState(device);

  await insertLog({
    event: body.event,
    alarm,
    deviceId: body.deviceId,
    time: typeof body.time === "string" ? body.time : undefined,
  });

  if (alarm && device) {
    await notifyOwner(device.ownerId, {
      title: `Alarm: ${device.name}`,
      body: "Door opened while system is armed!",
    });
  }

  return NextResponse.json({ ok: true });
}

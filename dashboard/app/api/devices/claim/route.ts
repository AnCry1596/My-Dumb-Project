import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// Called by the ESP32 itself during WiFi provisioning (captive portal), after the
// user typed in the 6-digit pairing code shown on the dashboard's "Add device" screen.
// The device generated its own random token locally; this call registers that token
// against the pending device row so future requests from this device can be verified
// (see verifyDeviceToken in lib/mongodb.ts). The claim code itself is the proof of
// authorization here — it's single-use and only exists because an owner created it.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const claimCode = typeof body.claimCode === "string" ? body.claimCode : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!deviceId || !claimCode || !token) {
    return NextResponse.json({ error: "deviceId, claimCode, and token are required" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB ?? "smartdoor");
  const devices = db.collection("devices");

  const pending = await devices.findOne({ claimCode, deviceId: "" });
  if (!pending) {
    return NextResponse.json({ error: "invalid or expired pairing code" }, { status: 404 });
  }

  await devices.updateOne(
    { _id: pending._id },
    { $set: { deviceId, token }, $unset: { claimCode: "" } }
  );

  return NextResponse.json({ ok: true, name: pending.name });
}

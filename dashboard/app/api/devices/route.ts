import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDevicesForOwner, createPendingDevice, computeAlarmedState, isDeviceOnline } from "@/lib/mongodb";
import { randomInt } from "crypto";

function generateClaimCode() {
  // 6 digits, easy to type into the ESP32's captive-portal form during setup
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const devices = await getDevicesForOwner(session.user.id);
  const withResolvedState = devices.map((d) => ({
    ...d,
    currentlyAlarmed: computeAlarmedState(d),
    online: isDeviceOnline(d),
  }));
  return NextResponse.json(withResolvedState);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "New device";

  const claimCode = generateClaimCode();
  const deviceObjectId = await createPendingDevice(session.user.id, claimCode, name);

  return NextResponse.json({ claimCode, deviceObjectId });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  renameDevice,
  deleteDevice,
  setDeviceArmed,
  setDeviceOverride,
  clearDeviceOverride,
  setDeviceSchedule,
  type ScheduleRule,
} from "@/lib/mongodb";

// Single PATCH endpoint for all device-settings changes an owner can make. Body
// shape decides which operation runs — only one at a time, but each is a plain
// object so the client can send exactly the field it changed.
export async function PATCH(request: Request, ctx: RouteContext<"/api/devices/[id]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const ownerId = session.user.id;
  let ok = false;

  if (typeof body.name === "string" && body.name.trim()) {
    ok = await renameDevice(ownerId, id, body.name.trim());
  } else if (typeof body.armed === "boolean") {
    ok = await setDeviceArmed(ownerId, id, body.armed);
  } else if (body.clearOverride === true) {
    ok = await clearDeviceOverride(ownerId, id);
  } else if (typeof body.overrideArmed === "boolean" && typeof body.overrideUntil === "string") {
    ok = await setDeviceOverride(ownerId, id, body.overrideArmed, body.overrideUntil);
  } else if (Array.isArray(body.scheduleRules)) {
    const rules = body.scheduleRules as ScheduleRule[];
    const tz = typeof body.timezoneOffsetMinutes === "number" ? body.timezoneOffsetMinutes : 0;
    ok = await setDeviceSchedule(ownerId, id, rules, tz);
  } else {
    return NextResponse.json({ error: "no recognized fields in request body" }, { status: 400 });
  }

  if (!ok) return NextResponse.json({ error: "device not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/devices/[id]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const ok = await deleteDevice(session.user.id, id);

  if (!ok) return NextResponse.json({ error: "device not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

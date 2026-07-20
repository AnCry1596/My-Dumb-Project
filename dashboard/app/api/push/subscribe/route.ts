import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { savePushSubscription, removePushSubscription } from "@/lib/mongodb";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.endpoint !== "string" || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }

  await savePushSubscription(session.user.id, {
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.endpoint !== "string") {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  await removePushSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLogsForOwner } from "@/lib/mongodb";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 25));

  const { logs, total } = await getLogsForOwner(session.user.id, page, pageSize);
  return NextResponse.json({ logs, total, page, pageSize });
}

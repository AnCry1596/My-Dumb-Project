import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createUser, findUserByEmail } from "@/lib/mongodb";

export async function POST(request: Request) {
  const { email, password, name } = await request.json();

  if (typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Email and a password of at least 8 characters are required" },
      { status: 400 }
    );
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await createUser(email, passwordHash, typeof name === "string" ? name : undefined);

  return NextResponse.json({ ok: true });
}

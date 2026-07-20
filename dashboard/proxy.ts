export { auth as proxy } from "@/auth";

export const config = {
  // Protect everything except the login/signup pages, NextAuth's own routes, and the
  // device-facing endpoints (auth'd separately via per-device tokens: log ingest + pairing claim),
  // and Next.js internals/static assets.
  matcher: [
    "/((?!login|signup|api/auth|api/signup|api/log|api/devices/claim|api/devices/state|sw\\.js|_next/static|_next/image|favicon.ico).*)",
  ],
};

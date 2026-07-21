import { NextResponse } from "next/server";
import type { NextFetchEvent, NextProxy, NextRequest } from "next/server";
import { auth } from "@/auth";

const authProxy = auth as unknown as NextProxy;

// NextAuth's own middleware builds its /login redirect (and the callbackUrl query
// param on it) from request.nextUrl, which behind this app's Caddy reverse proxy
// resolves to the internal listen address (localhost:3636) — confirmed by hitting
// Node directly with correct Host/X-Forwarded-Host headers and still getting
// localhost:3636 back, so header forwarding isn't the issue, request.nextUrl is.
// PUBLIC_ORIGIN pins the redirect to the real public domain instead.
const publicOrigin = process.env.PUBLIC_ORIGIN;

// Re-bases a URL (possibly absolute with the wrong internal host) onto publicOrigin,
// keeping only its path/search/hash.
function rebase(url: string, origin: string) {
  const parsed = new URL(url, origin);
  return new URL(parsed.pathname + parsed.search + parsed.hash, origin).toString();
}

export const proxy: NextProxy = publicOrigin
  ? async (request: NextRequest, event: NextFetchEvent) => {
      const result = await authProxy(request, event);
      const response = result instanceof Response ? result : NextResponse.next();
      const location = response.headers.get("location");
      if (location) {
        const fixed = new URL(rebase(location, publicOrigin));
        const callbackUrl = fixed.searchParams.get("callbackUrl");
        if (callbackUrl) fixed.searchParams.set("callbackUrl", rebase(callbackUrl, publicOrigin));
        response.headers.set("location", fixed.toString());
      }
      return response;
    }
  : authProxy;

export const config = {
  // Protect everything except the login/signup pages, NextAuth's own routes, the
  // device-facing endpoints (auth'd separately via per-device tokens: log ingest + pairing claim),
  // the cron endpoint (auth'd separately via CRON_SECRET — Vercel Cron has no session),
  // and Next.js internals/static assets.
  matcher: [
    "/((?!login|signup|api/auth|api/signup|api/log|api/devices/claim|api/devices/state|api/cron|sw\\.js|_next/static|_next/image|favicon.ico).*)",
  ],
};

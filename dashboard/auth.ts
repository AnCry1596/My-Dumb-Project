import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { findUserByEmail } from "@/lib/mongodb";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Self-hosted behind a reverse proxy (nginx/Caddy) — the app sees requests on an
  // internal host/port, not the public domain, so NextAuth's default same-host
  // check rejects them. trustHost tells it to trust X-Forwarded-Host instead.
  // Safe here because the app isn't directly exposed to the internet — only via
  // the proxy in front of it.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await findUserByEmail(email);
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user._id.toString(), email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
    // Runs in the proxy (see proxy.ts) — without this, auth() there only attaches
    // session info and never actually blocks unauthenticated requests.
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
});

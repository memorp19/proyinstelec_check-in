import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { handleJwt, handleSession, handleSignIn } from "./auth-callbacks";

if (!process.env.GOOGLE_CLIENT_ID) throw new Error("Missing GOOGLE_CLIENT_ID");
if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error("Missing GOOGLE_CLIENT_SECRET");
if (!process.env.NEXTAUTH_SECRET) throw new Error("Missing NEXTAUTH_SECRET");

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          // Request offline access so Google returns a refresh token
          access_type: "offline",
          prompt: "consent",
          // hd hint pre-selects @proyinstelec.mx accounts but does NOT restrict —
          // temporales can still sign in with any Google account
          hd: "proyinstelec.mx",
        },
      },
    }),
  ],
  pages: {
    signIn: "/unirse",      // custom sign-in page (handles both planta and temporal flows)
    error: "/auth/error",
  },
  callbacks: {
    signIn: (params) => handleSignIn(params),
    jwt: (params) => handleJwt(params),
    session: (params) => handleSession(params),
  },
};

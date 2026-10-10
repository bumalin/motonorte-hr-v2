// Optimistic check only (cookie present?). Real validation happens server-side in requireUser().
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/auth/token.ts";

export function proxy(req: NextRequest) {
  const isLogin = ["/login", "/activate"].includes(req.nextUrl.pathname);
  if (!isLogin && !req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"], // brand/: public logo, needed on the sign-in page
};

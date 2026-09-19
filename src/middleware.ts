import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, COOKIE } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/setup") || pathname.startsWith("/api/sair") || pathname.startsWith("/pesquisa/") || pathname.startsWith("/login/2fa") || pathname.startsWith("/_next") || pathname === "/favicon.ico") return NextResponse.next();
  const token = req.cookies.get(COOKIE)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) {
    const url = req.nextUrl.clone(); url.pathname = "/login"; url.search = "";
    return NextResponse.redirect(url);
  }
  const reqHeaders = new Headers(req.headers); reqHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: reqHeaders } });
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

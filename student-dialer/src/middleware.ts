import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Auth middleware. Refreshes Supabase session and gates protected routes.
 *
 * Note: Next.js 16 introduces `proxy.ts` as the new name for middleware,
 * but Vercel's adapter for that new convention is not stable yet.
 * Keeping the deprecated `middleware.ts` name + function until it lands.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - image extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

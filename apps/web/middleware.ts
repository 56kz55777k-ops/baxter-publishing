import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

/**
 * Root middleware — runs on every request that matches the matcher below.
 * Currently: refreshes the Supabase session.
 * Slice 2: adds route protection for (app) and (admin) groups.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Any file with a static asset extension
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)',
  ],
};

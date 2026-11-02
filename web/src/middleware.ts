import { NextResponse, type NextRequest } from 'next/server';

/**
 * Coarse-grained gate. Runs on the Edge runtime, so it may NOT import the
 * database client. It only checks that a session cookie exists; real validation
 * happens in the server components and server actions via requireUser() /
 * requireAgency() / resolveTenant().
 *
 * Deliberately no "already logged in -> redirect to /portal" logic: a stale
 * cookie would bounce between /login and /portal forever.
 */

const SESSION_COOKIE = 'omni_session';

const PROTECTED_PREFIXES = ['/agency', '/portal'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!isProtected) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/agency/:path*', '/portal/:path*'],
};

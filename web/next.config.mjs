import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];
const frameDeny = [{ key: 'X-Frame-Options', value: 'DENY' }];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: projectRoot,
  allowedDevOrigins: ['*.e2b.app'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The public call widget must be embeddable on client websites; the
      // authenticated consoles and sign-in stay clickjacking-protected.
      ...(process.env.NODE_ENV === 'production' ? [
        { source: '/agency/:path*', headers: frameDeny },
        { source: '/portal/:path*', headers: frameDeny },
        { source: '/login', headers: frameDeny },
        { source: '/no-access', headers: frameDeny },
      ] : []),
    ];
  },
};

export default nextConfig;

import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Origin des konfigurierten Karten-Tile-Servers für die CSP (img-src).
 * Standard: OSM-Tiles (nur Entwicklung – siehe docs/routing.md zur Produktion).
 */
function tileOrigin(): string {
  const url = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  try {
    return new URL(url.replace(/\{[a-z]\}/g, '0')).origin;
  } catch {
    return 'https://tile.openstreetmap.org';
  }
}

/**
 * Content-Security-Policy.
 *
 * `script-src 'unsafe-inline'` ist ein dokumentierter Kompromiss (Next-Bootstrap
 * ohne Nonce-Middleware); alle übrigen Direktiven sind strikt. Details und
 * Härtungsoptionen: docs/security.md.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${tileOrigin()}`,
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=(), usb=()' },
  // HSTS greift nur hinter HTTPS; im lokalen Dev ignorieren Browser den Header.
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  // Native Node-Module nicht bundeln (Argon2-Binärmodul, Prisma-Engine).
  serverExternalPackages: ['@node-rs/argon2', '@prisma/client'],
  // Zusätzliche erlaubte Origins im Dev (Zugriff über LAN-IP/Hostnamen),
  // kommagetrennt über DEV_ALLOWED_ORIGINS konfigurierbar.
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Der Service Worker darf nicht aggressiv gecacht werden.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;

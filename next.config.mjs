/**
 * Textures, models and CAD files are served from public/ without a content
 * hash, so Next marks them `max-age=0`: every visit asked the server about
 * each one again before the 3D view could use it. A day fresh and a week
 * stale-while-revalidate keeps a returning visitor off the network for them,
 * while a changed file still reaches everyone within a day.
 */
const ASSET_CACHE = 'public, max-age=86400, stale-while-revalidate=604800';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Three.js ships ESM; transpiling it avoids occasional App Router interop issues.
  transpilePackages: ['three'],
  async headers() {
    return ['/textures/:path*', '/models/:path*', '/cad/:path*'].map((source) => ({
      source,
      headers: [{ key: 'Cache-Control', value: ASSET_CACHE }],
    }));
  },
};

export default nextConfig;

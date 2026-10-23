/** @type {import('next').NextConfig} */
const nextConfig = {
  // Three.js ships ESM; transpiling it avoids occasional App Router interop issues.
  transpilePackages: ['three'],
};

export default nextConfig;

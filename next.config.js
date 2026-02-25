/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'better-sqlite3'],
  },
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'mammoth', 'pdf-parse'],
  },
};

module.exports = nextConfig;

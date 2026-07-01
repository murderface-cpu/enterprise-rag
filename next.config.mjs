/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Body size for upload routes: Vercel serverless default is 4.5MB,
  // bumped to allow reasonable document uploads (Pro plan supports more).
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // pdf-parse ships with test files that confuse bundlers; mark external.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "pdf-parse"];
    }
    return config;
  },
  // Better observability in Vercel logs.
  poweredByHeader: false,
};

export default nextConfig;
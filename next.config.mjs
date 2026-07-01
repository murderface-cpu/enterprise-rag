/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Body size for upload routes: Vercel serverless default is 4.5MB,
    // bumped to allow reasonable document uploads (Pro plan supports more).
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Keep these server-only packages OUT of the webpack bundle and load them
    // via native Node resolution instead. @xenova/transformers is ESM-only and
    // pulls in native ONNX bindings (onnxruntime-node) + optional sharp;
    // webpack `externals` would emit require() and break on ESM at runtime,
    // so we externalize them the Next.js way, which preserves dynamic import().
    serverComponentsExternalPackages: [
      "@xenova/transformers",
      "onnxruntime-node",
      "sharp",
    ],
  },
  // pdf-parse ships test files that confuse bundlers; keep it external (it is
  // CommonJS, so a plain require external is fine).
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

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
  // Native / heavy server-only deps that must not be bundled by webpack:
  //   - pdf-parse ships test files that confuse bundlers.
  //   - @xenova/transformers + onnxruntime-node load native ONNX bindings
  //     and model files at runtime; bundling breaks them.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(config.externals || []),
        "pdf-parse",
        "@xenova/transformers",
        "onnxruntime-node",
        "sharp",
      ];
    }
    return config;
  },
  // Better observability in Vercel logs.
  poweredByHeader: false,
};

export default nextConfig;
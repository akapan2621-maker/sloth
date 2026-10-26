/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The floating dev badge sits over the profile card in the bottom-left.
  devIndicators: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pdfjs-dist ships ESM workers; bundle them for the browser only.
      config.module.rules.push({
        test: /\.mjs$/,
        include: /node_modules[\\/]pdfjs-dist/,
        type: "javascript/esm",
      });
    }
    return config;
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // These ESM-only SDKs (Altana + BNB Agent) use dynamic require/import expressions
  // that Webpack cannot statically analyze. Load them at RUNTIME instead of
  // bundling, so the server route compiles and runs.
  experimental: {
    serverComponentsExternalPackages: ["@altananetwork/sdk", "@bnbagent/sdk"],
  },
};

export default nextConfig;

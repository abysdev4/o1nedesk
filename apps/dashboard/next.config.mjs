/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpila o codigo TS do pacote db; mantem libs nativas externas ao bundle
  transpilePackages: ["@onedesk/db"],
  serverExternalPackages: ["pg", "bcryptjs"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;

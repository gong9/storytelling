/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // 启用独立输出模式，优化 Docker 构建
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'better-sqlite3', 'langchain'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 抑制 langchain 的 "Critical dependency" 警告
      config.module.exprContextCritical = false;
    }
    return config;
  },
};

module.exports = nextConfig;

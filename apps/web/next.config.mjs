import createBundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = createBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default withBundleAnalyzer(nextConfig);

import { withSentryConfig } from "@sentry/nextjs";

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true
  }
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true
});

import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN_WEB) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN_WEB,
    tracesSampleRate: 0.1,
    environment: process.env.NEXT_PUBLIC_APP_ENV ?? "dev"
  });
}

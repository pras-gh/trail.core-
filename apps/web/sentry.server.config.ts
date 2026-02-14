import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN_WEB) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_WEB,
    tracesSampleRate: 0.1,
    environment: process.env.APP_ENV ?? "dev"
  });
}

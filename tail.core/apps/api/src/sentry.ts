import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): void {
  if (initialized) {
    return;
  }

  const dsn = process.env.SENTRY_DSN_API;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.APP_ENV ?? "dev",
    tracesSampleRate: 0.1
  });

  initialized = true;
}

export function captureException(error: unknown): void {
  if (initialized) {
    Sentry.captureException(error);
  }
}

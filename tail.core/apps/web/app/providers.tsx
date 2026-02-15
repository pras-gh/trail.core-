"use client";

import { useMemo } from "react";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

export function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  const posthogClient = useMemo(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

    if (!key || !host) {
      return null;
    }

    posthog.init(key, {
      api_host: host,
      capture_pageview: true
    });

    return posthog;
  }, []);

  if (!posthogClient) {
    return <>{children}</>;
  }

  return <PostHogProvider client={posthogClient}>{children}</PostHogProvider>;
}

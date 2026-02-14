import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers";

export const metadata = {
  title: "tail.core admin",
  description: "Upload pipeline admin"
};

function OptionalClerkProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return <>{children}</>;
  }

  return <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>;
}

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui, sans-serif", background: "#f4f6f8" }}>
        <OptionalClerkProvider>
          <Providers>{children}</Providers>
        </OptionalClerkProvider>
      </body>
    </html>
  );
}

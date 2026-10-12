import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import archivoLatin from "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2?url";
import jbMonoLatin from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";
import { NotFoundPage, RouteErrorPage } from "@/components/not-found";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "@/styles.css";

export const Route = createRootRoute({
  head: ({ matches }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: matches.some((match) => match._notFound || match.status === "notFound")
          ? "Page not found — gsc-mcp"
          : "gsc-mcp — Google Search Console MCP",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preload", href: archivoLatin, as: "font", type: "font/woff2", crossOrigin: "anonymous", fetchPriority: "high" },
      { rel: "preload", href: jbMonoLatin, as: "font", type: "font/woff2", crossOrigin: "anonymous", fetchPriority: "high" },
    ],
  }),
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error }) => (
    <RouteErrorPage message={error instanceof Error ? error.message : undefined} />
  ),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main id="main-content" className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

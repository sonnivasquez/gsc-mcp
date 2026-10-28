// Single source of truth for product facts shown on this site.
// Values mirror the MCP package root: package.json, README.md, PRIVACY.md.
export const PKG_NAME = "@sonnivasquez/gsc-mcp";
export const PKG_VERSION = "1.1.0";
export const PINNED_SPEC = `${PKG_NAME}@${PKG_VERSION}`;

export const TOKEN_DIR = "~/.gsc-mcp/";
export const TOKEN_DIR_MODE = "0700";
export const TOKEN_FILE_MODE = "0600";
export const OAUTH_CALLBACK = "http://127.0.0.1:3847";

export const MAINTAINER = {
  name: "Sonni Vasquez",
  site: "https://sonnivasquez.com",
  github: "https://github.com/sonnivasquez/gsc-mcp",
} as const;

// Example property identifiers. These are documentation examples, never a
// live property: replace them with your exact Search Console IDs.
export const EXAMPLE_DOMAIN_PROPERTY = "sc-domain:example.com";
export const EXAMPLE_URL_PROPERTY = "https://example.com/";

// Public origin for the site + docs, served from gscmcp.dev.
// No Google verification is claimed.
// Sole source for canonical/OG URLs: per-route heads derive from here.
export const SITE_ORIGIN = "https://gscmcp.dev";
export const SITE_NAME = "gsc-mcp";

export function siteCanonical(path: string): string {
  const trimmed = path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
  const suffix = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${SITE_ORIGIN}${suffix}`;
}

// Social preview image. Ships from web/public/og.png at 1200x630, the size
// every major platform renders without cropping. Declare its dimensions so
// crawlers reserve layout before the fetch finishes.
export const OG_IMAGE_PATH = "/og.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export function siteOgImage(): string {
  return `${SITE_ORIGIN}${OG_IMAGE_PATH}`;
}

export interface PageHeadInput {
  path: string;
  title: string;
  description: string;
}

// Shared head for the nine real pages: keeps the page's own title and
// description, adds absolute canonical + OG + Twitter summary tags.
// Never used on the root route (404s must not carry a canonical) or on the
// docs layout route (children already provide their own titles).
export function pageHead({ path, title, description }: PageHeadInput) {
  const canonical = siteCanonical(path);
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:url", content: canonical },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:image", content: siteOgImage() },
      { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
      { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
      { property: "og:image:alt", content: title },
      { property: "og:locale", content: "en_US" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: siteOgImage() },
    ],
    links: [{ rel: "canonical", href: canonical }],
  };
}

export type Runtime = "bun" | "node";

export const RUNTIME_LABEL: Record<Runtime, string> = {
  bun: "Bun ≥ 1",
  node: "Node ≥ 22",
};

export const RUNTIME_VERSION_COMMAND: Record<Runtime, string> = {
  bun: "bun --version",
  node: "node --version",
};

// Global installs keep the CLI available after runner caches are cleared.
export const SETUP_COMMAND: Record<Runtime, string> = {
  bun: `bun install -g ${PKG_NAME} && gsc setup`,
  node: `npm install -g ${PKG_NAME} && gsc setup`,
};

export const QUICK_SETUP_COMMAND = SETUP_COMMAND;

export const VERIFY_COMMAND: Record<Runtime, string> = {
  bun: "gsc doctor\ngsc auth status --online",
  node: "gsc doctor\ngsc auth status --online",
};

export interface ClientInfo {
  kind: "desktop" | "code" | "cursor" | "codex" | "generic" | "print";
  label: string;
  method: string;
  writes: boolean;
}

export const CLIENTS: readonly ClientInfo[] = [
  {
    kind: "desktop",
    label: "Claude Desktop",
    method: "config print --client desktop, then paste into claude_desktop_config.json",
    writes: true,
  },
  {
    kind: "code",
    label: "Claude Code",
    method: "config print --client code, then run the exact command it prints",
    writes: true,
  },
  {
    kind: "cursor",
    label: "Cursor",
    method: "config print --client cursor, then Settings › MCP",
    writes: true,
  },
  {
    kind: "codex",
    label: "Codex",
    method: "config print --client codex, then run the exact command it prints",
    writes: true,
  },
  {
    kind: "generic",
    label: "Any other client",
    method: "config print --client generic, then apply the JSON yourself",
    writes: false,
  },
  {
    kind: "print",
    label: "Print only",
    method: "Preview mode: prints JSON, never writes client config",
    writes: false,
  },
] as const;

export interface DocNavItem {
  to: string;
  label: string;
  blurb: string;
}

export const DOC_NAV: readonly DocNavItem[] = [
  {
    to: "/docs",
    label: "Installation",
    blurb: "Prerequisites, the one setup command, and verification",
  },
  {
    to: "/docs/credentials",
    label: "Credentials",
    blurb: "Quick Connect, Desktop OAuth, and service accounts",
  },
  {
    to: "/docs/clients",
    label: "Clients",
    blurb: "Connect Claude Desktop, Code, Cursor, Codex, or generic",
  },
  {
    to: "/docs/commands",
    label: "Commands",
    blurb: "setup, serve, doctor, auth, and config reference",
  },
  {
    to: "/docs/troubleshooting",
    label: "Troubleshooting",
    blurb: "Named errors, what each means, and the exact fix",
  },
  {
    to: "/docs/uninstall",
    label: "Uninstall",
    blurb: "Remove the client entry, local state, and access",
  },
] as const;

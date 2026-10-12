import { useEffect, useRef, type MouseEvent } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { DOC_NAV } from "@/lib/site";
import { cn } from "@/lib/utils";

interface SectionLink {
  id: string;
  label: string;
}

const DOC_SECTIONS: Record<string, readonly SectionLink[]> = {
  "/docs": [
    { id: "requirements", label: "Before you start" },
    { id: "install", label: "Install" },
    { id: "connect", label: "Connect Google and a client" },
    { id: "verify", label: "Verify" },
    { id: "properties", label: "Choose properties" },
    { id: "update", label: "Update or reinstall" },
    { id: "next", label: "Next" },
  ],
  "/docs/credentials": [
    { id: "quick-connect", label: "Quick Connect" },
    { id: "scopes", label: "Access modes" },
    { id: "oauth", label: "Your OAuth client" },
    { id: "service-account", label: "Service account" },
    { id: "sources", label: "Google references" },
    { id: "next", label: "Next" },
  ],
  "/docs/clients": [
    { id: "connect", label: "Choose your client" },
    { id: "other-clients", label: "Other clients" },
    { id: "verify", label: "Check the connection" },
    { id: "next", label: "More help" },
  ],
  "/docs/commands": [
    { id: "everyday", label: "Common commands" },
    { id: "setup", label: "setup" },
    { id: "access", label: "Change access" },
    { id: "deprecated", label: "Deprecated flags" },
    { id: "server", label: "MCP server" },
    { id: "doctor", label: "doctor" },
    { id: "auth", label: "auth" },
    { id: "config", label: "Print configuration" },
    { id: "environment", label: "Environment" },
    { id: "opt-ins", label: "Optional setup actions" },
    { id: "help", label: "Help and version" },
    { id: "next", label: "Next" },
  ],
  "/docs/troubleshooting": [
    { id: "no-tools", label: "Client shows no tools" },
    { id: "sign-in", label: "Sign-in fails" },
    { id: "property", label: "Property is missing" },
    { id: "google-errors", label: "Google access or API error" },
    { id: "oauth", label: "invalid_grant" },
    { id: "partial", label: "Partial results" },
    { id: "expired", label: "Expired dataset" },
    { id: "writes", label: "Write tool unavailable" },
    { id: "next", label: "Next" },
  ],
  "/docs/uninstall": [
    { id: "client", label: "Remove the client entry" },
    { id: "revoke", label: "Optional Google revocation" },
    { id: "package", label: "Remove the package" },
    { id: "local-data", label: "Optional local data removal" },
    { id: "next", label: "Next" },
  ],
};

function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "");
  return path || "/";
}

function SectionLinks({
  items,
  onNavigate,
}: {
  items: readonly SectionLink[];
  onNavigate: (id: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <ul className="docs-index-list">
      {items.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`} onClick={(event) => onNavigate(item.id, event)}>
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DocsLayout() {
  const { pathname } = useLocation();
  const currentPath = normalizePath(pathname);
  const current = DOC_NAV.findIndex((item) => item.to === currentPath);
  const currentItem = DOC_NAV[current === -1 ? 0 : current];
  const prev = current > 0 ? DOC_NAV[current - 1] : undefined;
  const next = current >= 0 && current < DOC_NAV.length - 1 ? DOC_NAV[current + 1] : undefined;
  const sections = DOC_SECTIONS[currentPath] ?? [];

  const guidesDisclosure = useRef<HTMLDetailsElement>(null);
  const indexDisclosure = useRef<HTMLDetailsElement>(null);
  const previousPath = useRef(currentPath);

  useEffect(() => {
    guidesDisclosure.current?.removeAttribute("open");
    indexDisclosure.current?.removeAttribute("open");

    if (previousPath.current !== currentPath) {
      previousPath.current = currentPath;
      document.getElementById("docs-article")?.focus({ preventScroll: true });
    }
  }, [currentPath]);

  function closeMobileGuides() {
    if (guidesDisclosure.current) guidesDisclosure.current.open = false;
  }

  function closeMobileIndex(id: string, event: MouseEvent<HTMLAnchorElement>) {
    if (indexDisclosure.current) indexDisclosure.current.open = false;
    if (event.detail === 0) {
      requestAnimationFrame(() => {
        document.getElementById(id)?.focus({ preventScroll: true });
      });
    }
  }

  return (
    <div className="docs-shell">
      <div className="docs-mobile-nav">
        <details className="docs-mobile-disclosure" ref={guidesDisclosure}>
          <summary>
            <span className="docs-mobile-summary-label">
              Guides <span aria-hidden="true">·</span> {currentItem?.label ?? "Guide"}
            </span>
          </summary>
          <ul className="docs-mobile-link-list">
            {DOC_NAV.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={item.to === currentPath ? "page" : undefined}
                  className={cn(
                    "docs-mobile-link",
                    item.to === currentPath && "docs-mobile-link-active",
                  )}
                  onClick={(event) => {
                    closeMobileGuides();
                    if (item.to === currentPath && event.detail === 0) {
                      requestAnimationFrame(() => {
                        document.getElementById("docs-article")?.focus({ preventScroll: true });
                      });
                    }
                  }}
                >
                  <span>{item.label}</span>
                  <span className="docs-mobile-link-blurb">{item.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>

        <details className="docs-mobile-disclosure" ref={indexDisclosure}>
          <summary>On this page</summary>
          <SectionLinks items={sections} onNavigate={closeMobileIndex} />
        </details>
      </div>

      <div className="docs-layout-grid">
        <aside aria-label="Guide navigation" className="docs-guides docs-guides-desktop">
          <nav aria-label="Guide pages" className="docs-sticky-nav">
            <p className="docs-nav-label">Guides</p>
            <ul className="docs-guide-list">
              {DOC_NAV.map((item) => {
                const active = item.to === currentPath;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      className={cn("docs-guide-link", active && "docs-guide-link-active")}
                    >
                      <span className="docs-guide-title">{item.label}</span>
                      <span className="docs-guide-blurb">{item.blurb}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <div id="docs-article" tabIndex={-1} className="docs-main">
          <Outlet />

          <nav aria-label="Next guide" className="docs-next-guides">
            {prev ? (
              <Link to={prev.to} className="docs-next-guide">
                <span className="docs-next-direction">← Previous</span>
                <span className="docs-next-title">{prev.label}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={next.to} className="docs-next-guide docs-next-guide-next">
                <span className="docs-next-direction">Next →</span>
                <span className="docs-next-title">{next.label}</span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </div>

        <aside aria-label="Page contents" className="docs-index docs-index-desktop">
          <nav aria-label="On this page" className="docs-sticky-nav">
            <p className="docs-nav-label">On this page</p>
            <SectionLinks items={sections} onNavigate={closeMobileIndex} />
          </nav>
        </aside>
      </div>
    </div>
  );
}

import { Link, useLocation } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { DOC_NAV, MAINTAINER, PKG_VERSION } from "@/lib/site";

const PRODUCT_LINKS = [
  { hash: "#use-cases", label: "Use cases" },
  { hash: "#tools", label: "Tools" },
] as const;

const GET_STARTED_LINKS = DOC_NAV.slice(0, 3);
const REFERENCE_LINKS = DOC_NAV.slice(3);

const LEGAL_LINKS = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
] as const;

// Exact matching keeps Installation (/docs) from reading as current on child guides.
const EXACT_ACTIVE = { exact: true } as const;

const footerLinkClassName =
  "site-nav-link flex min-h-[44px] min-w-11 items-center px-3 text-sm text-ink-soft";

export function SiteFooter() {
  const isHome = useLocation({ select: (location) => location.pathname === "/" });

  return (
    <footer
      data-site-chrome="footer"
      data-site-chrome-variant={isHome ? "home" : "internal"}
      className="bg-paper"
    >
      <div className="home-container home-footer-layout border-t border-line py-8">
        <div className="home-footer-brand-block">
          <Link to="/" className="home-footer-brand">
            <BrandMark />
            GSC MCP
          </Link>
          <p className="home-footer-caption">Search Console, inside your AI workflow.</p>
        </div>

        <nav aria-label="Footer" className="home-footer-nav">
          <div className="home-footer-group">
            <h2 className="home-footer-heading">Product</h2>
            <ul className="home-footer-list">
              {PRODUCT_LINKS.map((item) => (
                <li key={item.hash}>
                  <a href={isHome ? item.hash : `/${item.hash}`} className={footerLinkClassName}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="home-footer-group">
            <h2 className="home-footer-heading">Get started</h2>
            <ul className="home-footer-list">
              {GET_STARTED_LINKS.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    activeOptions={EXACT_ACTIVE}
                    activeProps={{ "data-active": "true" }}
                    className={footerLinkClassName}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="home-footer-group">
            <h2 className="home-footer-heading">Reference</h2>
            <ul className="home-footer-list">
              {REFERENCE_LINKS.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    activeOptions={EXACT_ACTIVE}
                    activeProps={{ "data-active": "true" }}
                    className={footerLinkClassName}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="home-footer-utility">
          <nav aria-label="Legal" className="home-footer-legal">
            {LEGAL_LINKS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={EXACT_ACTIVE}
                activeProps={{ "data-active": "true" }}
                className={footerLinkClassName}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <p className="home-footer-attribution">
            Maintained by{" "}
            <a href={MAINTAINER.site} target="_blank" rel="noreferrer">
              {MAINTAINER.name}
            </a>
            .<br />
            gsc-mcp {PKG_VERSION}<br />
            Apache-2.0 · Base-project attribution in NOTICE.
          </p>
        </div>
      </div>
    </footer>
  );
}

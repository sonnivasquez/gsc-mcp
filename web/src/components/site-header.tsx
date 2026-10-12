import { Link, useLocation } from "@tanstack/react-router";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { GitHubIcon } from "@/components/github-icon";
import { MAINTAINER } from "@/lib/site";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/docs", label: "Docs" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
] as const;

const HOME_ANCHORS = [
  ["#use-cases", "Use cases"],
  ["#tools", "Tools"],
] as const;

export function SiteHeader() {
  const isHome = useLocation({ select: (location) => location.pathname === "/" });
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Move focus to the toggle only when focus is inside the menu.
      // An outside focus position is left exactly where it is.
      if (menuRef.current?.contains(document.activeElement)) {
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const installHref = isHome ? "/docs" : "/#install";
  const installLabel = isHome ? "Get started" : "Install";

  return (
    <header
      data-site-chrome="header"
      data-site-chrome-variant={isHome ? "home" : "internal"}
      className="sticky top-0 z-50 border-b border-line bg-paper"
    >
      <nav aria-label="Primary" className="home-container mx-auto flex h-16 items-center gap-2">
        <Link
          to="/"
          className="home-brand flex min-h-11 shrink-0 items-center gap-2 font-sans text-base font-semibold tracking-tight text-ink"
        >
          <BrandMark className="size-7 text-cobalt" />
          <span>GSC MCP</span>
        </Link>

        <div className="site-header-nav items-center gap-1">
          {HOME_ANCHORS.map(([href, label]) => (
              <a
                key={href}
                href={isHome ? href : `/${href}`}
                className="site-nav-link rounded-md px-3 py-2 text-base font-medium text-ink-soft"
              >
                {label}
              </a>
            ))}
          {NAV.filter((item) => item.to === "/docs").map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ "data-active": "true" }}
              className="site-nav-link rounded-md px-3 py-2 text-base font-medium text-ink-soft data-[active=true]:font-semibold"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <a
            href={MAINTAINER.github}
            target="_blank"
            rel="noreferrer"
            className="home-header-github"
          >
            <GitHubIcon className="size-4" />
            GitHub
          </a>
          <a
            href={installHref}
            className="home-nav-install min-h-11 items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-cobalt"
          >
            {installLabel}
            {isHome && <ArrowRight aria-hidden="true" className="size-4" />}
          </a>
          <button
            type="button"
            ref={toggleRef}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="site-header-toggle flex size-11 items-center justify-center rounded-md text-ink hover:bg-cobalt-wash"
          >
            {open ? (
              <X aria-hidden="true" className="size-5" />
            ) : (
              <Menu aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
      </nav>

      <div
        id="mobile-menu"
        ref={menuRef}
        className={cn("site-header-menu border-t border-line", !open && "hidden")}
      >
        <ul className="home-container mx-auto flex flex-col gap-1 py-3">
          {HOME_ANCHORS.map(([href, label]) => (
              <li key={href}>
                <a
                  href={isHome ? href : `/${href}`}
                  onClick={() => setOpen(false)}
                  className="site-nav-link block px-3 py-3 text-base text-ink-soft"
                >
                  {label}
                </a>
              </li>
            ))}
          {NAV.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={() => setOpen(false)}
                activeProps={{ "data-active": "true" }}
                className="site-nav-link block px-3 py-3 text-base text-ink-soft data-[active=true]:font-semibold"
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <a
              href={MAINTAINER.github}
              target="_blank"
              rel="noreferrer"
              className="site-nav-link flex items-center gap-2 px-3 py-3 text-base text-ink-soft"
            >
              <GitHubIcon className="size-4" />
              GitHub
            </a>
          </li>
          <li>
            <a
              href={installHref}
              onClick={() => setOpen(false)}
              className="home-nav-install block rounded-md bg-ink px-3 py-3 text-center text-base font-semibold text-paper"
            >
              {installLabel}
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}

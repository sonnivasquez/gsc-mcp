import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="max-w-xl">
        <p className="tnum font-mono text-sm font-semibold text-cobalt-deep">404</p>
        <h1 className="mt-2 font-display text-[length:var(--ds-type-page)] font-semibold tracking-[-0.02em] text-balance text-ink">
          This page doesn&rsquo;t exist.
        </h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          The link may be wrong or the page moved. Start over, or jump into
          the docs to find the command you need.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/">Back to home</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link to="/docs">Read the docs</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DocsNotFoundPage() {
  return (
    <div className="py-8">
      <p className="tnum font-mono text-sm font-semibold text-cobalt-deep">404</p>
      <h1 className="mt-2 font-display text-[length:var(--ds-type-page)] font-semibold tracking-[-0.02em] text-ink">
        No doc at this address.
      </h1>
      <p className="mt-3 max-w-xl leading-relaxed text-ink-soft">
        The guide may have moved. The six topics below cover everything the
        server does — start with installation.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild size="lg" className="h-auto max-w-full min-h-11 py-2 text-center leading-snug whitespace-normal">
          <Link to="/docs">Back to installation</Link>
        </Button>
        <Button asChild size="lg" variant="secondary" className="h-auto max-w-full min-h-11 py-2 text-center leading-snug whitespace-normal">
          <Link to="/docs/troubleshooting">Troubleshooting</Link>
        </Button>
      </div>
    </div>
  );
}

export function RouteErrorPage({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="max-w-xl">
        <p className="font-mono text-sm font-semibold text-cobalt-deep">ERROR</p>
        <h1 className="mt-2 font-display text-[length:var(--ds-type-page)] font-semibold tracking-[-0.02em] text-ink">
          Something failed to load.
        </h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          {message ?? "Reload the page. If it persists, the static copy of the docs below still applies."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/">Back to home</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link to="/docs">Read the docs</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

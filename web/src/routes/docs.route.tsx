import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "@/components/docs-layout";
import { DocsNotFoundPage } from "@/components/not-found";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
  notFoundComponent: DocsNotFoundPage,
  // No generic title here: every docs page provides its own via pageHead.
  // Only the docs-aware 404 names itself, so parent and child never duplicate.
  head: ({ match }) =>
    match._notFound || match.status === "notFound"
      ? {
          meta: [{ title: "No doc at this address — gsc-mcp docs" }],
        }
      : { meta: [] },
});

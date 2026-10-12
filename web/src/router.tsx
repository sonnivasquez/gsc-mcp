import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Named contract for the app router. The factory below stays per-request
// safe for SSR; this probe instance only carries the type.
const routerProbe = createRouter({ routeTree, scrollRestoration: true });

export type AppRouter = typeof routerProbe;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}

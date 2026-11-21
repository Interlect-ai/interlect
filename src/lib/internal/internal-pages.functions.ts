import { createServerFn } from "@tanstack/react-start";
import { internalPagesEnabled } from "./internal-pages";

/**
 * Whether the internal pages exist here; decided on the server only. A build
 * (`import.meta.env.DEV` is false) never has them, whatever the environment says.
 */
export const getInternalPagesEnabled = createServerFn({ method: "GET" }).handler(
  async () => import.meta.env.DEV && internalPagesEnabled(process.env),
);

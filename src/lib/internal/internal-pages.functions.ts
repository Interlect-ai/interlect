import { createServerFn } from "@tanstack/react-start";
import { internalPagesEnabled } from "./internal-pages";

/** Whether this installation shows the internal pages; decided on the server only. */
export const getInternalPagesEnabled = createServerFn({ method: "GET" }).handler(async () =>
  internalPagesEnabled(process.env),
);

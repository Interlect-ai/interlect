import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * "Ny investeringstese" had its own eight-step guide. Since a new thesis is set up on the
 * same Teamopsætning as editing, so old links and bookmarks open it there (`/fond?ny=1`); answers
 * the old guide left in the browser are carried over by the page (`NewThesisStart`).
 */
export const Route = createFileRoute("/fond/ny")({
  beforeLoad: () => {
    throw redirect({ to: "/fond", search: { ny: 1 }, replace: true });
  },
});

import { createFileRoute, redirect } from "@tanstack/react-router";

/** Dokumentkøen bor nu som fane i casebasen. */
export const Route = createFileRoute("/pitch-decks")({
  beforeLoad: () => {
    throw redirect({ to: "/cases" });
  },
});

import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Analysemetode er slettet fra produktet (beslutningslog 15. okt: ingen steder står, hvordan
 * analysen blev lavet). Gamle links og bogmærker sendes til Teamopsætning.
 */
export const Route = createFileRoute("/fond/metode")({
  beforeLoad: () => {
    throw redirect({ to: "/fond", replace: true });
  },
});

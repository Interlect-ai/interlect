/**
 * /intern/orbs: every occasion in the orb catalogue (src/lib/ai/orb-occasions.ts) side by
 * side with its states in phase order, sizes per placement, tone and fixed text, so the
 * catalogue can be approved in one place. Only one orb moves at
 * a time: the chosen card animates, the others stand still. "Næste fase" steps through the
 * occasion's states with the crossfade from OccasionOrb.
 */
import { useState } from "react";
import { OccasionOrb } from "@/components/ai/OccasionOrb";
import { AiOrb } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import {
  ORB_OCCASIONS,
  type OrbOccasion,
  type OrbOccasionId,
  type OrbPlacement,
} from "@/lib/ai/orb-occasions";
import { cn } from "@/lib/utils";

const PLACEMENT_LABEL: Record<OrbPlacement, string> = {
  inline: "I teksten",
  card: "Kort",
  thread: "Tråd",
  specialist: "Specialist",
  page: "Venteside",
  empty: "Tom tilstand",
};

const TEXT_SOURCE: Record<NonNullable<OrbOccasion["textSource"]>, string> = {
  "run-steps": "Trin fra RunSteps",
  "specialist-name": "Specialistens navn",
  "visible-steps": "Synlige trin",
};

export function OrbGallery() {
  const ids = Object.keys(ORB_OCCASIONS) as OrbOccasionId[];
  const [active, setActive] = useState<OrbOccasionId>(ids[0]!);
  const [phase, setPhase] = useState(0);

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
      {ids.map((id) => {
        const entry: OrbOccasion = ORB_OCCASIONS[id];
        const isActive = id === active;
        const placements = Object.keys(entry.sizes) as OrbPlacement[];
        return (
          <section
            key={id}
            onClick={() => {
              if (!isActive) {
                setActive(id);
                setPhase(0);
              }
            }}
            className={cn(
              "flex min-w-0 cursor-pointer flex-col gap-4 overflow-hidden rounded-lg bg-surface p-[22px] shadow-card transition-shadow duration-[var(--dur-quick)]",
              isActive && "shadow-[0_0_0_1.5px_var(--ink-1),var(--shadow-card)]",
            )}
          >
            <div className="flex flex-col gap-0.5">
              <h3 className="m-0 text-section font-semibold">{entry.name}</h3>
              <span className="text-micro text-ink-4">
                {entry.tone === "ai" ? "Koral: AI arbejder" : "Blæk: almindelig ventetid"}
                {entry.onDark ? ", på primærknap" : ""}
              </span>
            </div>
            <div
              className={cn(
                "flex min-h-[96px] items-end gap-6 rounded-md px-4 py-4",
                entry.onDark ? "bg-inverse" : "bg-canvas",
              )}
            >
              {placements.map((placement) => (
                <span key={placement} className="flex flex-col items-center gap-2">
                  {entry.onDark ? (
                    <AiOrb
                      size={entry.sizes[placement] ?? 20}
                      state={entry.states[0]}
                      tone={entry.tone}
                      onDark
                      paused={!isActive}
                    />
                  ) : (
                    <OccasionOrb
                      occasion={id}
                      phase={isActive ? phase : 0}
                      placement={placement}
                      paused={!isActive}
                    />
                  )}
                  <span
                    className={cn(
                      "text-micro",
                      entry.onDark ? "text-ink-inverse opacity-70" : "text-ink-4",
                    )}
                  >
                    {PLACEMENT_LABEL[placement]} · {entry.sizes[placement]}
                  </span>
                </span>
              ))}
            </div>
            <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-meta">
              <dt className="text-ink-4">Tilstande</dt>
              <dd className="m-0 text-ink-2">
                {entry.states.map((state, index) => (
                  <span key={state}>
                    {index > 0 && " → "}
                    <span
                      className={cn(
                        isActive &&
                          index === Math.min(phase, entry.states.length - 1) &&
                          "font-medium text-ink-1",
                      )}
                    >
                      {state}
                    </span>
                  </span>
                ))}
              </dd>
              <dt className="text-ink-4">Tekst</dt>
              <dd className="m-0 text-ink-2">
                {entry.text ?? (entry.textSource ? TEXT_SOURCE[entry.textSource] : "Ingen")}
              </dd>
            </dl>
            {isActive && entry.states.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={(event) => {
                  event.stopPropagation();
                  setPhase((p) => (p + 1) % entry.states.length);
                }}
              >
                Næste fase
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}

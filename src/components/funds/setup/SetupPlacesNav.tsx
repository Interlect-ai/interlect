/**
 * (§2.1): the four places of Teamopsætning as one pill group with the sliding
 * marker (`SegmentedControl`). A place the draft changed carries a small dot (the same orange dot
 * as "Kladde vN" elsewhere on the page); no "Trin N af 8".
 */
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { SETUP_PLACES, type SetupPlaceKey } from "@/lib/funds/setup-places";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";

export const PLACE_LABEL: Record<SetupPlaceKey, MessageKey> = {
  thesis: "fundSetup.places.thesis.label",
  screening: "fundSetup.places.screening.label",
  analysis: "fundSetup.places.analysis.label",
  publish: "fundSetup.places.publish.label",
};

export const PLACES_ID = "setup-places";

export function SetupPlacesNav({
  value,
  onChange,
  changed,
  only,
}: {
  value: SetupPlaceKey;
  onChange: (place: SetupPlaceKey) => void;
  changed?: ReadonlySet<SetupPlaceKey>;
  /** Only this place can be chosen (a new thesis before its draft exists). */
  only?: SetupPlaceKey;
}) {
  const t = useT();
  return (
    <div className="overflow-x-auto [scrollbar-width:none]">
      <SegmentedControl
        aria-label={t("fundSetup.places.navLabel")}
        tabs={{ idPrefix: PLACES_ID }}
        value={value}
        onChange={onChange}
        className="w-max"
        options={SETUP_PLACES.map((place) => ({
          value: place.key,
          label: t(PLACE_LABEL[place.key]),
          ...(changed?.has(place.key) ? { dot: "var(--warning)" } : {}),
          disabled: only !== undefined && place.key !== only,
        }))}
      />
    </div>
  );
}

/** The panel under the pills (role tabpanel, labelled by the selected pill). */
export function placePanelProps(place: SetupPlaceKey) {
  return {
    role: "tabpanel" as const,
    id: `${PLACES_ID}-panel`,
    "aria-labelledby": `${PLACES_ID}-tab-${place}`,
  };
}

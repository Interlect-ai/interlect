/**
 * P2: en sektion, brugeren kan skjule. "Skjul" toner frem ved hover eller fokus (designreglen
 * om sekundære handlinger) og er altid synlig på touch-skærme uden hover. Valget huskes pr.
 * bruger (user_preferences) og sendes som tilføj/fjern, som serveren fletter.
 * `HiddenSectionsBar` viser de skjulte sektioner på siden og kan hente dem tilbage.
 */
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { getHiddenSections, setHiddenSections } from "@/lib/preferences/preferences.functions";

const QUERY_KEY = ["hidden-sections"] as const;
const RESTORE_SELECTOR = "[data-hidden-sections-restore]";

function focusSoon(selector: string) {
  // Vent, til React har indsat eller fjernet sektionen (højst ca. 20 billeder).
  let frames = 0;
  const tryFocus = () => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.focus();
    else if (frames++ < 20) requestAnimationFrame(tryFocus);
  };
  requestAnimationFrame(tryFocus);
}

export function useHiddenSections() {
  const load = useServerFn(getHiddenSections);
  const save = useServerFn(setHiddenSections);
  const queryClient = useQueryClient();
  const t = useT();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => load(), staleTime: 5 * 60_000 });
  const mutation = useMutation({
    mutationKey: QUERY_KEY,
    // Kør ændringerne én ad gangen i klik-rækkefølge.
    scope: { id: "hidden-sections" },
    mutationFn: (change: { add?: string[]; remove?: string[] }) => save({ data: change }),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<string[]>(QUERY_KEY) ?? [];
      const next = [...new Set([...previous, ...(change.add ?? [])])].filter(
        (key) => !(change.remove ?? []).includes(key),
      );
      queryClient.setQueryData(QUERY_KEY, next);
      return { previous };
    },
    onError: (_error, _change, context) => {
      queryClient.setQueryData(QUERY_KEY, context?.previous ?? []);
      toast.error(t("shared.hideable.saveFailed"));
    },
    onSettled: () => {
      // Hent først igen, når den sidste ændring i rækken er færdig.
      if (queryClient.isMutating({ mutationKey: QUERY_KEY }) === 1) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      }
    },
  });
  const hidden = query.data ?? [];
  return {
    /** Listen er hentet; før da kan intet skjules (så en gemt liste aldrig overskrives). */
    ready: query.isSuccess,
    hidden,
    isHidden: (key: string) => hidden.includes(key),
    hide: (key: string) => {
      mutation.mutate({ add: [key] });
      focusSoon(RESTORE_SELECTOR);
    },
    show: (keys: string[]) => {
      mutation.mutate({ remove: keys });
      if (keys[0]) focusSoon(`[data-hideable="${keys[0]}"]`);
    },
  };
}

export function Hideable({
  sectionKey,
  label,
  children,
}: {
  sectionKey: string;
  label: string;
  children: ReactNode;
}) {
  const { ready, isHidden, hide } = useHiddenSections();
  const t = useT();
  if (isHidden(sectionKey)) return null;
  return (
    <div className="group/hideable relative outline-none" data-hideable={sectionKey} tabIndex={-1}>
      {ready && (
        <button
          type="button"
          onClick={() => hide(sectionKey)}
          aria-label={t("shared.hideable.hide", { label })}
          title={t("shared.hideable.hide", { label })}
          className="absolute -right-2.5 -top-2.5 z-10 grid size-6 place-items-center rounded-full border border-hairline bg-surface text-ink-4 opacity-0 shadow-sm transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/hideable:opacity-100 pointer-coarse:opacity-100"
        >
          <EyeOff className="size-3" aria-hidden />
        </button>
      )}
      {children}
    </div>
  );
}

/**
 * Viser, hvilke af sidens sektioner der er skjult, og henter dem tilbage. Kun sektioner,
 * der faktisk findes på den aktuelle case, nævnes (`present`).
 */
export function HiddenSectionsBar({
  sections,
}: {
  sections: Array<{ key: string; label: string; present?: boolean }>;
}) {
  const { hidden, show } = useHiddenSections();
  const t = useT();
  const hiddenHere = sections.filter(
    (section) => section.present !== false && hidden.includes(section.key),
  );
  return (
    <div aria-live="polite">
      {hiddenHere.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-3 text-meta text-ink-3">
          <span>
            {t("shared.hideable.hidden", {
              labels: hiddenHere.map((section) => section.label).join(", "),
            })}
          </span>
          <button
            type="button"
            data-hidden-sections-restore
            onClick={() => show(hiddenHere.map((section) => section.key))}
            className="rounded-sm text-action hover:text-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          >
            {t("shared.hideable.showAgain")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Har casen regnskaber? Læser den delte cache uden selv at hente (økonomisektionen henter). */
export function useHasFinancials(caseId: string): boolean {
  const language = useLanguage();
  // The server writes the key figures in the fund's language, so the key carries it.
  const query = useQuery<{ metrics?: { years: string[] } }>({
    queryKey: ["financial-statements", caseId, language],
    enabled: false,
  });
  return Boolean(query.data?.metrics?.years.length);
}

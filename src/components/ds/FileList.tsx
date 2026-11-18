/**
 * The case "Filer" tab (Case Screening v5, `showFilesTab`; "v0.5"): an upload
 * surface at the top, a search field and a quiet type filter, then every file in one list.
 *
 * Measured in the prototype:
 * - Upload surface: padding 18/20, radius lg, canvas with an inset 1.5 px line-strong ring;
 *   hover turns the ring action and the ground action-wash. 38 px tile (radius 11, surface,
 *   pill shadow, action icon 17 px), 15/500 title and a 12 px ink-3 line under it.
 *   While a file is dragged over it scales 1 → 1.015 with a coral ring (smooth spring, "Drag og
 *   drop"); a press scales to.995.
 * - Search: 40 px sunken pill, 14 px text, flex 1 1 260 px, field focus (surface + 1.5 px
 *   action + 4 px action-wash); a 22 px clear button while there is a query.
 * - Type filter: 36 px buttons, radius 10, 12/500; the chosen one is filled ink.
 * - Row: grid 36 px / 1fr / auto / 32 px, gap 14, min height 64, padding 10 14 10 16, hairline
 *   between rows, hover tint. Tile 36 px radius 10 in the type's series colour at 14 %
 *   (pdf series-3, xlsx series-6, docx series-1), name 15/500, "hvem, hvornår" 12 px ink-3,
 *   link as a 6 px dot + name, 32 px round download button.
 * - Empty: padding 28/20, radius lg, canvas, 14 px ink-3, centred.
 *
 * Rows arriving with the tab rise in with the house row stagger; a file added after that
 * (a new upload) pops in from scale .9. On small screens the link moves under the name.
 * The component is presentational: files, upload and download come in as props.
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  FileType,
  Search,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { AiImageFx } from "@/components/ai/AiImageFx";
import { OccasionOrb } from "@/components/ai/OccasionOrb";
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { translate } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { REDUCED_FADE, SPRING, rowEnter } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** One file on the case. Field names follow CaseFile (src/lib/cases/files.functions.ts). */
export interface FileListItem {
  id: string;
  fileName: string;
  /** Who added it, e.g. "Maja Holm" or "Hentet af Interlect". */
  uploadedBy: string;
  /** ISO time the file was added; shown with `formatWhen`. */
  createdAt: string;
  /** What the file belongs to (criterion, task, "Generelt"); dot colour as a token. */
  link?: { label: string; color?: string | undefined } | null | undefined;
}

/** The filter options (Alle, PDF, Regneark, Dokumenter). */
export type FileKindFilter = "alle" | "pdf" | "xlsx" | "docx";

type FileFormat = "pdf" | "xlsx" | "docx" | "other";

const KIND_FILTERS: readonly FileKindFilter[] = ["alle", "pdf", "xlsx", "docx"];

const FORMAT_LOOK: Record<FileFormat, { icon: LucideIcon; color: string }> = {
  pdf: { icon: FileText, color: "var(--series-3)" },
  xlsx: { icon: FileSpreadsheet, color: "var(--series-6)" },
  docx: { icon: FileType, color: "var(--series-1)" },
  // Not in the prototype: any other format gets a neutral tile and only shows under "Alle".
  other: { icon: FileIcon, color: "var(--ink-3)" },
};

const SHEET_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "csv", "ods", "numbers"]);
const DOC_EXTENSIONS = new Set(["docx", "doc", "odt", "rtf", "txt", "md", "pages"]);

function fileFormat(fileName: string): FileFormat {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return "pdf";
  if (SHEET_EXTENSIONS.has(extension)) return "xlsx";
  if (DOC_EXTENSIONS.has(extension)) return "docx";
  return "other";
}

const TIME_ZONE = "Europe/Copenhagen";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const datePartsByLanguage = new Map<Language, Intl.DateTimeFormat>();

function dateParts(language: Language): Intl.DateTimeFormat {
  let format = datePartsByLanguage.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(LANGUAGE_TAGS[language], {
      timeZone: TIME_ZONE,
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    datePartsByLanguage.set(language, format);
  }
  return format;
}

/** "i dag", "i går", "23. sep" or "23. sep 2025" (Copenhagen time, no abbreviation dots). */
function defaultFormatWhen(iso: string, language: Language = DEFAULT_LANGUAGE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const day = dayKey.format(date);
  if (day === dayKey.format(now)) return translate(language, "shared.files.today");
  if (day === dayKey.format(new Date(now.getTime() - 86_400_000))) {
    return translate(language, "shared.files.yesterday");
  }
  const parts = dateParts(language).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value.replace(/\.$/, "") ?? "";
  const vars = { day: part("day"), month: part("month"), year: part("year") };
  return day.slice(0, 4) === dayKey.format(now).slice(0, 4)
    ? translate(language, "shared.files.date", vars)
    : translate(language, "shared.files.dateYear", vars);
}

function matchesQuery(file: FileListItem, query: string) {
  if (!query) return true;
  return [file.fileName, file.uploadedBy, file.link?.label ?? ""].some((value) =>
    value.toLowerCase().includes(query),
  );
}

function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function FileList({
  files,
  onUpload,
  onDownload,
  uploading = false,
  accept,
  query: controlledQuery,
  onQueryChange,
  kind: controlledKind,
  onKindChange,
  filtering = "local",
  formatWhen,
  className,
}: {
  files: readonly FileListItem[];
  /** Files chosen in the picker or dropped on the upload surface. Without it there is no upload surface. */
  onUpload?: ((files: File[]) => void) | undefined;
  onDownload: (file: FileListItem) => void;
  /** An upload is running: the tile shows the waiting orb. */
  uploading?: boolean | undefined;
  /** `accept` for the file picker, e.g. ".pdf,.xlsx,.docx". */
  accept?: string | undefined;
  /** Controlled search text (optional; the component keeps its own otherwise). */
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  /** Controlled type filter (optional). */
  kind?: FileKindFilter | undefined;
  onKindChange?: ((kind: FileKindFilter) => void) | undefined;
  /** "local" filters `files` here; "server" shows `files` as given (already filtered). */
  filtering?: "local" | "server" | undefined;
  formatWhen?: ((createdAt: string) => string) | undefined;
  className?: string | undefined;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [ownQuery, setOwnQuery] = useState("");
  const [ownKind, setOwnKind] = useState<FileKindFilter>("alle");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const query = controlledQuery ?? ownQuery;
  const kind = controlledKind ?? ownKind;
  const setQuery = (value: string) => {
    if (controlledQuery === undefined) setOwnQuery(value);
    onQueryChange?.(value);
  };
  const setKind = (value: FileKindFilter) => {
    if (controlledKind === undefined) setOwnKind(value);
    onKindChange?.(value);
  };

  // Ids seen in an earlier commit: a row that is not among them is a new upload and pops in.
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const known = knownIds.current ?? new Set<string>();
    for (const file of files) known.add(file.id);
    knownIds.current = known;
  }, [files]);

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const shown =
    filtering === "server"
      ? files
      : files.filter(
          (file) =>
            (kind === "alle" || fileFormat(file.fileName) === kind) && matchesQuery(file, needle),
        );
  const emptyText = trimmed
    ? t("shared.files.noMatch", { query: trimmed })
    : t(`shared.files.empty.${kind}`);

  const upload = (list: ArrayLike<File> | null) => {
    const chosen = list ? Array.from(list) : [];
    if (chosen.length && onUpload) onUpload(chosen);
  };

  const dragHandlers = onUpload
    ? {
        onDragEnter: (event: DragEvent<HTMLButtonElement>) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (event: DragEvent<HTMLButtonElement>) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          upload(event.dataTransfer.files);
        },
      }
    : {};

  return (
    <div className={cn("flex min-w-0 max-w-[820px] flex-col gap-3.5", className)}>
      {onUpload && (
        <>
          <AiImageFx active={uploading}>
            <motion.button
              type="button"
              onClick={() => pickerRef.current?.click()}
              aria-busy={uploading || undefined}
              animate={{ scale: dragging && !reduced ? 1.015 : 1 }}
              transition={reduced ? REDUCED_FADE : SPRING.smooth}
              {...(reduced ? {} : { whileTap: { scale: 0.995 } })}
              {...dragHandlers}
              className={cn(
                "group relative flex w-full min-w-0 items-center gap-3.5 rounded-lg px-5 py-[18px] text-left outline-none",
                "transition-[box-shadow,background-color] duration-200",
                "focus-visible:ring-2 focus-visible:ring-action",
                dragging
                  ? "bg-canvas shadow-[inset_0_0_0_2px_var(--ai)]"
                  : "bg-canvas shadow-[inset_0_0_0_1.5px_var(--line-strong)] hover:bg-action-wash hover:shadow-[inset_0_0_0_1.5px_var(--action)]",
              )}
            >
              <span className="grid size-[38px] shrink-0 place-items-center rounded-[11px] bg-surface text-action shadow-pill">
                {uploading ? (
                  <OccasionOrb occasion="waiting" />
                ) : (
                  <Upload className="size-[17px]" strokeWidth={1.75} aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] font-medium text-ink-1">
                  {t("shared.files.uploadTitle")}
                </span>
                <span className="text-meta text-ink-3">{t("shared.files.uploadHint")}</span>
              </span>
            </motion.button>
          </AiImageFx>
          <input
            ref={pickerRef}
            type="file"
            multiple
            hidden
            {...(accept ? { accept } : {})}
            onChange={(event) => {
              upload(event.currentTarget.files);
              // Let the same file be chosen again after a failed upload.
              event.currentTarget.value = "";
            }}
          />
        </>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <label
          className={cn(
            "flex h-10 min-w-0 flex-[1_1_260px] items-center gap-2.5 rounded-pill bg-sunken px-3.5",
            "transition-[box-shadow,background-color] duration-[var(--dur-quick)]",
            "focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]",
          )}
        >
          <Search className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("shared.files.search")}
            aria-label={t("shared.files.search")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink-1 outline-none placeholder:text-ink-4 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("shared.files.clearSearch")}
              className="grid size-[22px] shrink-0 place-items-center rounded-full bg-hover text-ink-3 outline-none hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
            >
              <X className="size-[11px]" strokeWidth={2} aria-hidden />
            </button>
          )}
        </label>
        <div role="group" aria-label={t("shared.files.filterLabel")} className="flex gap-0.5">
          {KIND_FILTERS.map((option) => {
            const active = option === kind;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => setKind(option)}
                className={cn(
                  "h-9 rounded-sm px-3 text-meta font-medium whitespace-nowrap outline-none",
                  "transition-[background-color,color] duration-[var(--dur-quick)] focus-visible:ring-2 focus-visible:ring-action",
                  active ? "bg-inverse text-ink-inverse" : "text-ink-2 hover:bg-hover",
                )}
              >
                {t(`shared.files.filter.${option}`)}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <motion.p
          key={emptyText}
          role="status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduced ? REDUCED_FADE : { duration: 0.3 }}
          className="m-0 rounded-lg bg-canvas px-5 py-7 text-center text-[14px] text-ink-3"
        >
          {emptyText}
        </motion.p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg bg-surface p-0 shadow-card">
          {shown.map((file, index) => {
            const isNew = knownIds.current !== null && !knownIds.current.has(file.id);
            return (
              <FileRow
                key={file.id}
                file={file}
                index={index}
                isNew={isNew}
                reduced={Boolean(reduced)}
                when={
                  formatWhen
                    ? formatWhen(file.createdAt)
                    : defaultFormatWhen(file.createdAt, language)
                }
                onDownload={onDownload}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FileRow({
  file,
  index,
  isNew,
  reduced,
  when,
  onDownload,
}: {
  file: FileListItem;
  index: number;
  isNew: boolean;
  reduced: boolean;
  when: string;
  onDownload: (file: FileListItem) => void;
}) {
  const t = useT();
  const look = FORMAT_LOOK[fileFormat(file.fileName)];
  const Icon = look.icon;
  const meta = when ? `${file.uploadedBy}, ${when}` : file.uploadedBy;
  const link = file.link ? (
    <span className="flex min-w-0 items-center gap-1.5 text-meta whitespace-nowrap text-ink-3">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: file.link.color ?? "var(--ink-4)" }}
        aria-hidden
      />
      <span className="truncate">{file.link.label}</span>
    </span>
  ) : null;

  const motionProps = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
    : isNew
      ? {
          initial: { opacity: 0, scale: 0.9 },
          animate: { opacity: 1, scale: 1 },
          transition: SPRING.smooth,
        }
      : { variants: rowEnter, initial: "hidden", animate: "visible", custom: index };

  return (
    <motion.li
      {...motionProps}
      className={cn(
        "grid min-h-16 grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-3.5 py-2.5 pr-3.5 pl-4 transition-colors duration-[var(--dur-quick)] hover:bg-hover sm:grid-cols-[36px_minmax(0,1fr)_auto_32px]",
        index > 0 && "border-t border-line",
      )}
    >
      <span
        className="grid size-9 place-items-center rounded-sm"
        style={{
          background: `color-mix(in srgb, ${look.color} 14%, transparent)`,
          color: look.color,
        }}
        aria-hidden
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium text-ink-1">{file.fileName}</span>
        <span className="truncate text-meta text-ink-3">{meta}</span>
        {link && <span className="flex min-w-0 sm:hidden">{link}</span>}
      </div>
      {link ? (
        <span className="hidden max-w-[240px] min-w-0 sm:flex">{link}</span>
      ) : (
        <span className="hidden sm:block" />
      )}
      <button
        type="button"
        onClick={() => onDownload(file)}
        aria-label={t("shared.files.downloadName", { name: file.fileName })}
        title={t("shared.files.download")}
        className="grid size-8 place-items-center rounded-full text-ink-3 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
      >
        <Download className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    </motion.li>
  );
}

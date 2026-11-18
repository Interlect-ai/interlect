/**
 * Brain's history, shown under the menu (`AppShell railExtra`, Interlect Brain prototype):
 * "Ny samtale", then I dag / Tidligere / Delt i team. Rows are 34 px; rename, share and delete
 * sit in a menu that appears on hover or focus (secondary actions are never repeated on every
 * row). Delete is a hard delete after a dialog (proposal); only the owner may rename and
 * share, only the owner or an Admin (team threads) may delete (`threads.ts`).
 * Under the conversations: "Kilder", which opens what Brain has read, with "Glem" and
 * "Prøv igen". ("Lært" is gone from the screen, Brain uses what it learns in the answers.)
 */
import { useEffect, useRef, useState } from "react";
import { Library, Link2, MoreHorizontal, Pencil, SquarePen, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ds/Menu";
import type { BrainThreadSummary } from "@/lib/brain/chat-contract";
import { canDeleteThread, canEditThread, groupThreads, threadTitle } from "@/lib/brain/threads";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

/** The id of the "Kilder" button: focus returns to it when the drawer closes. */
export const SOURCES_BUTTON_ID = "brain-kilder";

export interface ThreadActions {
  onRename: (thread: BrainThreadSummary, title: string) => Promise<void>;
  onToggleShare: (thread: BrainThreadSummary) => Promise<void>;
  onDelete: (thread: BrainThreadSummary) => Promise<void>;
}

export function ThreadList({
  threads,
  activeId,
  isAdmin,
  loading = false,
  failed = false,
  onNew,
  onSelect,
  actions,
  sources,
}: {
  threads: readonly BrainThreadSummary[];
  activeId: string | null;
  isAdmin: boolean;
  loading?: boolean;
  failed?: boolean;
  onNew: () => void;
  onSelect: (thread: BrainThreadSummary) => void;
  /** Without actions (the Admin test page) the row menu is left out. */
  actions?: ThreadActions | undefined;
  /** "Kilder" under the conversations; left out on the Admin test page. */
  sources?: { open: boolean; onToggle: () => void } | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const groups = groupThreads(threads, new Date(), language);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BrainThreadSummary | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-2 mt-4 mb-3 h-px bg-line" />
      <button
        type="button"
        onClick={onNew}
        className="flex h-[38px] shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left text-list font-medium text-ink-1 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
      >
        <SquarePen className="size-[15px]" strokeWidth={1.75} aria-hidden />
        {t("brainChat.threads.newThread")}
      </button>
      <nav
        aria-label={t("brainChat.threads.navLabel")}
        className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pt-1.5"
      >
        {loading && threads.length === 0 && (
          <p className="m-0 px-3 py-2 text-meta text-ink-4">{t("brainChat.threads.loading")}</p>
        )}
        {failed && threads.length === 0 && (
          <p className="m-0 px-3 py-2 text-meta text-ink-3">{t("brainChat.threads.loadFailed")}</p>
        )}
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-px">
            <span className="px-3 pt-2.5 pb-1 text-micro font-semibold text-ink-4">
              {group.label}
            </span>
            {group.threads.map((thread) =>
              renaming === thread.id && actions ? (
                <RenameRow
                  key={thread.id}
                  thread={thread}
                  onDone={async (title) => {
                    setRenaming(null);
                    if (title && title !== threadTitle(thread, language))
                      await actions.onRename(thread, title);
                  }}
                />
              ) : (
                <Row
                  key={thread.id}
                  thread={thread}
                  active={thread.id === activeId}
                  showOwner={group.key === "team"}
                  onSelect={() => onSelect(thread)}
                  menu={
                    actions
                      ? {
                          canEdit: canEditThread(thread),
                          canDelete: canDeleteThread(thread, isAdmin),
                          onRename: () => setRenaming(thread.id),
                          onToggleShare: () => void actions.onToggleShare(thread),
                          onDelete: () => setDeleting(thread),
                        }
                      : undefined
                  }
                />
              ),
            )}
          </div>
        ))}
      </nav>
      {sources && (
        <>
          <div className="mx-2 mt-2 mb-1.5 h-px shrink-0 bg-line" />
          <button
            id={SOURCES_BUTTON_ID}
            type="button"
            onClick={sources.onToggle}
            aria-expanded={sources.open}
            className={cn(
              "flex h-[34px] shrink-0 items-center gap-2.5 rounded-[8px] px-3 text-left text-list outline-none transition-colors duration-[var(--dur-quick)] focus-visible:ring-2 focus-visible:ring-action",
              sources.open ? "bg-sunken text-ink-1" : "text-ink-2 hover:bg-hover hover:text-ink-1",
            )}
          >
            <Library className="size-[15px] text-ink-3" strokeWidth={1.75} aria-hidden />
            <span className="flex-1">{t("brainChat.threads.sources")}</span>
          </button>
        </>
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !deletePending && setDeleting(null)}
        title={t("brainChat.threads.deleteTitle")}
        description={t("brainChat.threads.deleteBody")}
        footer={
          <>
            <Button
              variant="quiet"
              size="md"
              disabled={deletePending}
              onClick={() => setDeleting(null)}
            >
              {t("brainChat.threads.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={deletePending}
              onClick={async () => {
                if (!deleting || !actions) return;
                setDeletePending(true);
                try {
                  await actions.onDelete(deleting);
                } finally {
                  setDeletePending(false);
                  setDeleting(null);
                }
              }}
            >
              {t("brainChat.threads.deleteConfirm")}
            </Button>
          </>
        }
      >
        {deleting && (
          <p className="m-0 text-list text-ink-2">
            {threadTitle(deleting, language)}
            {!deleting.isMine && ` ${t("brainChat.threads.sharedByColleague")}`}
          </p>
        )}
      </Dialog>
    </div>
  );
}

function Row({
  thread,
  active,
  showOwner,
  onSelect,
  menu,
}: {
  thread: BrainThreadSummary;
  active: boolean;
  showOwner: boolean;
  onSelect: () => void;
  menu:
    | {
        canEdit: boolean;
        canDelete: boolean;
        onRename: () => void;
        onToggleShare: () => void;
        onDelete: () => void;
      }
    | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const hasMenu = menu && (menu.canEdit || menu.canDelete);
  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        title={threadTitle(thread, language)}
        className={cn(
          "flex h-[34px] w-full items-center gap-1.5 rounded-[8px] px-3 text-left text-list outline-none transition-colors duration-[var(--dur-quick)] focus-visible:ring-2 focus-visible:ring-action",
          hasMenu && "pr-8",
          active ? "bg-sunken text-ink-1" : "text-ink-3 hover:bg-hover hover:text-ink-1",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{threadTitle(thread, language)}</span>
        {thread.caseName && (
          // The title keeps most of the row; a long case name is cut instead.
          <span className="max-w-[45%] min-w-0 shrink-0 truncate text-micro text-ink-4">
            {thread.caseName}
          </span>
        )}
        {thread.visibility === "team" && thread.isMine && (
          <Users
            className="size-3 shrink-0 text-ink-4"
            strokeWidth={1.75}
            aria-label={t("brainChat.threads.sharedWithTeam")}
          />
        )}
        {showOwner && thread.ownerName && (
          <span className="shrink-0 text-micro text-ink-4">{thread.ownerName}</span>
        )}
      </button>
      {hasMenu && (
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={t("brainChat.threads.actionsFor", {
                title: threadTitle(thread, language),
              })}
              className="absolute top-1 right-1 grid size-[26px] place-items-center rounded-[7px] text-ink-3 opacity-0 outline-none transition-opacity duration-[var(--dur-quick)] group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            {menu.canEdit && (
              <MenuItem icon={Pencil} onSelect={menu.onRename}>
                {t("brainChat.threads.rename")}
              </MenuItem>
            )}
            {menu.canEdit && (
              <MenuItem
                icon={thread.visibility === "team" ? Link2 : Users}
                onSelect={menu.onToggleShare}
              >
                {thread.visibility === "team"
                  ? t("brainChat.threads.makePrivate")
                  : t("brainChat.threads.shareWithTeam")}
              </MenuItem>
            )}
            {menu.canDelete && (
              <MenuItem icon={Trash2} destructive onSelect={menu.onDelete}>
                {t("brainChat.threads.delete")}
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}

function RenameRow({
  thread,
  onDone,
}: {
  thread: BrainThreadSummary;
  onDone: (title: string) => Promise<void>;
}) {
  const t = useT();
  const language = useLanguage();
  const [value, setValue] = useState(threadTitle(thread, language));
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    void onDone(save ? value.trim() : "");
  };
  return (
    <input
      ref={inputRef}
      value={value}
      maxLength={120}
      aria-label={t("brainChat.threads.renameLabel")}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
      className="h-[34px] w-full rounded-[8px] bg-surface px-3 text-list text-ink-1 shadow-[0_0_0_1px_var(--line-strong)] outline-none focus-visible:ring-2 focus-visible:ring-action"
    />
  );
}

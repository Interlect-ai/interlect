/**
 * The case tabs Noter, Beskeder and Filer (Case Screening v5, lines 200–232; "Case-faner" and v0.5
 * "Filer"). Real data: case_notes, case_messages (live through Supabase
 * Realtime, RLS decides who gets them) and the case's documents.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { ChatThread, type ChatItem } from "@/components/ds/ChatThread";
import { FileList, type FileListItem } from "@/components/ds/FileList";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { showToast } from "@/components/ds/Toast";
import { addCaseNote } from "@/lib/cases/cases.functions";
import {
  listCaseMessages,
  postCaseMessage,
  type CaseMessage,
} from "@/lib/cases/messages.functions";
import { getCaseFileUrl } from "@/lib/cases/files.functions";
import { CASE_FILE_ACCEPT, caseFileProblemIn } from "@/lib/cases/case-files";
import type { TaskItem } from "@/components/ds/task-types";
import { userMessage } from "@/lib/errors/user-message";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { useCaseFileUpload } from "./useCaseFileUpload";
import {
  filesKey,
  markMessagesSeen,
  messagesKey,
  notesKey,
  useCaseFiles,
  useCaseMessages,
  useCaseNotes,
  when,
} from "./case-tab-data";

// ---------------------------------------------------------------------------
// Noter
// ---------------------------------------------------------------------------

export function NotesTab({ fundId, caseId }: { fundId: string; caseId: string }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const queryClient = useQueryClient();
  const notes = useCaseNotes(fundId, caseId);
  const add = useServerFn(addCaseNote);
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: (body: string) => add({ data: { fundId, caseId, body } }),
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: notesKey(caseId) });
    },
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("screening.notes.saveError"), language),
        tone: "error",
      }),
  });
  // A second click before the first save returns must not save the note twice.
  const ready = draft.trim().length > 0 && !save.isPending;

  return (
    <div className="flex max-w-[760px] flex-col gap-3.5">
      <div className="flex flex-col gap-2.5 rounded-lg bg-canvas p-4">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("screening.notes.placeholder")}
          aria-label={t("screening.notes.label")}
          maxLength={4000}
          className="min-h-16 resize-none border-0 bg-transparent text-[15px] leading-[1.55] text-ink-1 outline-none"
        />
        <div className="flex items-center justify-end">
          <Button
            variant="primary"
            size="sm"
            disabled={!ready}
            pending={save.isPending}
            onClick={() => ready && save.mutate(draft.trim())}
          >
            {t("screening.notes.save")}
          </Button>
        </div>
      </div>
      {notes.isLoading && <LoadingState title={t("screening.notes.loading")} />}
      {notes.isError && (
        <ErrorState title={t("screening.notes.loadError")} onRetry={() => void notes.refetch()} />
      )}
      {notes.data?.length === 0 && (
        <p className="m-0 px-1 py-4 text-list text-ink-3">{t("screening.notes.empty")}</p>
      )}
      {notes.data?.map((note, index) => (
        <motion.div
          key={note.id}
          className="flex flex-col gap-1.5 border-b border-line px-1 py-[18px]"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduced
              ? REDUCED_FADE
              : { duration: 0.42, ease: EASE.out, delay: Math.min(index, 8) * 0.05 }
          }
        >
          <div className="flex items-center gap-2 text-meta text-ink-3">
            <span className="font-semibold text-ink-1">
              {note.authorName ?? t("screening.notes.unknownUser")}
            </span>
            <span>{when(note.createdAt, language)}</span>
          </div>
          <p className="m-0 text-[15px] leading-[1.6] whitespace-pre-line text-ink-1">
            {note.body}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Beskeder
// ---------------------------------------------------------------------------

function chatItems(messages: readonly CaseMessage[]): ChatItem[] {
  return messages.map((message) =>
    message.kind === "system"
      ? {
          kind: "system" as const,
          id: message.id,
          body: message.body,
          icon: UserRoundCheck,
          iconColor: "var(--positive)",
        }
      : {
          kind: "user" as const,
          id: message.id,
          body: message.body,
          authorName: message.authorName,
          isMine: message.isMine,
          createdAt: message.createdAt,
          editedAt: message.editedAt,
          deleted: message.deleted,
        },
  );
}

export function MessagesTab({
  fundId,
  caseId,
  messages,
}: {
  fundId: string;
  caseId: string;
  messages: ReturnType<typeof useCaseMessages>;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const post = useServerFn(postCaseMessage);
  const [draft, setDraft] = useState("");
  const send = useMutation({
    mutationFn: (body: string) => post({ data: { fundId, caseId, body } }),
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: messagesKey(caseId, fundId) });
    },
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("screening.messages.sendError"), language),
        tone: "error",
      }),
  });
  useEffect(() => markMessagesSeen(messages.data, caseId), [messages.data, caseId]);

  if (messages.isLoading) return <LoadingState title={t("screening.messages.loading")} />;
  if (messages.isError) {
    return (
      <ErrorState
        title={t("screening.messages.loadError")}
        onRetry={() => void messages.refetch()}
      />
    );
  }
  return (
    <ChatThread
      className="max-w-[760px]"
      variant="case"
      items={chatItems(messages.data ?? [])}
      empty={<p className="m-0 py-4 text-list text-ink-3">{t("screening.messages.empty")}</p>}
      draft={draft}
      onDraftChange={setDraft}
      onSend={(body) => send.mutateAsync(body.trim())}
      sending={send.isPending}
      placeholder={t("screening.messages.placeholder")}
      formatTime={(iso) => when(iso, language)}
    />
  );
}

// ---------------------------------------------------------------------------
// Filer
// ---------------------------------------------------------------------------

export function FilesTab({
  fundId,
  caseId,
  files,
  tasks,
  canUpload,
}: {
  fundId: string;
  caseId: string;
  files: ReturnType<typeof useCaseFiles>;
  tasks: readonly TaskItem[];
  canUpload: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const upload = useCaseFileUpload(fundId, caseId);
  const fileUrl = useServerFn(getCaseFileUrl);
  const [uploading, setUploading] = useState(false);

  const items: FileListItem[] = (files.data ?? []).map((file) => {
    const task = file.taskId ? tasks.find((entry) => entry.id === file.taskId) : null;
    return {
      id: file.id,
      fileName: file.fileName,
      uploadedBy: file.uploadedByName ?? t("screening.files.unknownUser"),
      createdAt: file.createdAt,
      link: task
        ? { label: task.title, color: task.link?.color ?? "var(--ink-4)" }
        : file.kind === "pitch_deck"
          ? { label: t("screening.files.pitchDeck"), color: "var(--ink-4)" }
          : { label: t("screening.files.general"), color: "var(--ink-4)" },
    };
  });

  const onUpload = async (chosen: File[]) => {
    const problems = chosen
      .map((file) => caseFileProblemIn(file, language))
      .filter((problem): problem is string => !!problem);
    if (problems.length) showToast({ message: problems[0]!, tone: "error" });
    const ok = chosen.filter((file) => !caseFileProblemIn(file, language));
    if (!ok.length) return;
    setUploading(true);
    try {
      for (const file of ok) await upload(file);
      showToast({
        message:
          ok.length === 1
            ? t("screening.files.addedOne", { name: ok[0]!.name })
            : t("screening.files.addedMany", { count: ok.length }),
      });
    } catch (cause) {
      showToast({
        message: userMessage(cause, t("screening.files.addError"), language),
        tone: "error",
      });
    } finally {
      setUploading(false);
      await queryClient.invalidateQueries({ queryKey: filesKey(caseId, fundId) });
    }
  };

  const onDownload = async (file: FileListItem) => {
    try {
      const { url } = await fileUrl({ data: { fundId, documentId: file.id } });
      window.location.assign(url);
    } catch (cause) {
      showToast({
        message: userMessage(cause, t("screening.files.downloadError"), language),
        tone: "error",
      });
    }
  };

  if (files.isLoading) return <LoadingState title={t("screening.files.loading")} />;
  if (files.isError) {
    return (
      <ErrorState title={t("screening.files.loadError")} onRetry={() => void files.refetch()} />
    );
  }
  return (
    <FileList
      className="max-w-[820px]"
      files={items}
      {...(canUpload ? { onUpload: (chosen: File[]) => void onUpload(chosen) } : {})}
      onDownload={(file) => void onDownload(file)}
      uploading={uploading}
      accept={CASE_FILE_ACCEPT}
      formatWhen={(iso) => when(iso, language)}
    />
  );
}

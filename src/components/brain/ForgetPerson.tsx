/**
 * "Glem person" on a person's "Hvem var det nu lige?" card, for those who may
 * forget (admin, brain_forget; the server checks it again). The confirmation opens inside the card,
 * so the pop-up never stacks a second dialog: it says what happens, shows the files that name the
 * person (read first, nothing changes) and lets the admin delete those files too. No AI call.
 * There is no prototype for this; it follows (quiet destructive button, Toggle).
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Toggle } from "@/components/ds/Toggle";
import { showToast } from "@/components/ds/Toast";
import { forgetBrainPerson, previewForgetBrainPerson } from "@/lib/brain/forget-person.functions";
import { useT, useLanguage } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";

const SHOWN_FILES = 4;

export function ForgetPerson({
  fundId,
  entityId,
  name,
}: {
  fundId: string;
  entityId: string;
  name: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="flex justify-end">
        <Button variant="danger" size="sm" icon={Trash2} onClick={() => setOpen(true)}>
          {t("brainKnowledge.card.forget.button")}
        </Button>
      </div>
    );
  }
  return (
    <ForgetConfirm
      fundId={fundId}
      entityId={entityId}
      name={name}
      onCancel={() => setOpen(false)}
    />
  );
}

function ForgetConfirm({
  fundId,
  entityId,
  name,
  onCancel,
}: {
  fundId: string;
  entityId: string;
  name: string;
  onCancel: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const titleId = useId();
  const queryClient = useQueryClient();
  const preview = useServerFn(previewForgetBrainPerson);
  const forget = useServerFn(forgetBrainPerson);
  const [removeFiles, setRemoveFiles] = useState(true);
  const files = useQuery({
    queryKey: ["brain-forget-preview", fundId, entityId],
    queryFn: () => preview({ data: { fundId, entityId } }),
    retry: false,
    staleTime: 0,
  });
  const shownName = files.data?.name || name;
  const count = files.data?.files.length ?? 0;
  const mutation = useMutation({
    mutationFn: () => forget({ data: { fundId, entityId, removeFiles: count > 0 && removeFiles } }),
    onSuccess: (result) => {
      showToast({
        message:
          result.filesKept > 0
            ? t("brainKnowledge.card.forget.doneFilesKept", { name: shownName })
            : t("brainKnowledge.card.forget.done", { name: shownName }),
      });
    },
    // Also after an error that comes once the person is forgotten (a vector or a late file): the
    // person is gone from cards, pages, the brain map and the chat's sources.
    onSettled: () => void queryClient.invalidateQueries(),
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("brainKnowledge.card.forget.failed"), language),
        tone: "error",
      }),
  });

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-[12px] bg-surface p-3.5 shadow-[inset_0_0_0_1px_var(--critical-wash)]"
    >
      <div className="flex flex-col gap-1">
        <h4 id={titleId} className="m-0 text-list font-semibold text-ink-1">
          {t("brainKnowledge.card.forget.title", { name: shownName })}
        </h4>
        <p className="m-0 text-list text-ink-2">{t("brainKnowledge.card.forget.body")}</p>
        <p className="m-0 text-meta text-ink-3">{t("brainKnowledge.card.forget.firstName")}</p>
      </div>

      {files.isLoading ? (
        <p className="m-0 text-meta text-ink-3" role="status" aria-busy="true">
          {t("brainKnowledge.card.forget.loading")}
        </p>
      ) : files.isError ? (
        <p className="m-0 text-meta text-critical" role="alert">
          {t("brainKnowledge.card.forget.previewError")}
        </p>
      ) : count > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-list font-medium text-ink-1">
            {count === 1
              ? t("brainKnowledge.card.forget.filesOne")
              : t("brainKnowledge.card.forget.filesMany", { count })}
          </p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-meta text-ink-2">
            {files.data!.files.slice(0, SHOWN_FILES).map((file, index) => (
              <li key={`${file.kind}:${index}`} className="truncate">
                {file.name}
                <span className="text-ink-4">
                  {" · "}
                  {file.kind === "document"
                    ? t("brainKnowledge.card.forget.onCase")
                    : t("brainKnowledge.card.forget.inBrain")}
                </span>
              </li>
            ))}
            {count > SHOWN_FILES && (
              <li className="text-ink-3">
                {t("brainKnowledge.card.forget.moreFiles", { count: count - SHOWN_FILES })}
              </li>
            )}
          </ul>
          <label className="flex items-center justify-between gap-3">
            <span className="text-list text-ink-1">
              {t("brainKnowledge.card.forget.removeFiles")}
            </span>
            <Toggle
              checked={removeFiles}
              onCheckedChange={setRemoveFiles}
              label={t("brainKnowledge.card.forget.removeFiles")}
            />
          </label>
          <p className="m-0 text-meta text-ink-3">
            {removeFiles
              ? t("brainKnowledge.card.forget.removeFilesHint")
              : t("brainKnowledge.card.forget.keepFilesHint")}
          </p>
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={mutation.isPending}>
          {t("brainKnowledge.card.forget.cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={Trash2}
          pending={mutation.isPending}
          disabled={files.isLoading || files.isError || mutation.isSuccess}
          onClick={() => mutation.mutate()}
        >
          {t("brainKnowledge.card.forget.confirm")}
        </Button>
      </div>
    </section>
  );
}

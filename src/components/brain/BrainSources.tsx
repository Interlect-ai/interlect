/**
 * Brain · Kilder: the internal Admin page where files, text and the fund's own
 * website are given to Brain. Upload
 * (a signed URL to the private bucket), the approval before anything is read (no amount, P13), progress,
 * retry from the failed step, download and "Glem kilde". The real Kilder page is designed later
 * So this page is plain and holds no design of its own.
 */
import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Download, FileText, Globe, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { showToast } from "@/components/ds/Toast";
import {
  approveBrainIngest,
  completeBrainUpload,
  getBrainSourceDownloadUrl,
  listBrainSources,
  requestBrainUpload,
  retryBrainIngest,
  submitBrainText,
  type BrainSourceRow,
} from "@/lib/brain/ingest.functions";
import { forgetBrainSource } from "@/lib/brain/forget.functions";
import {
  confirmWebsitePortfolio,
  getWebsitePortfolio,
  submitBrainWebsite,
} from "@/lib/brain/website.functions";
import { BRAIN_SOURCES_BUCKET } from "@/lib/brain/ingest/bucket";
import {
  docTypeLabel,
  formatBytes,
  formatPeriod,
  kindLabel,
  trustLabel,
} from "@/lib/brain/ingest/labels";
import { phaseLabel, stepLabel as stepLabelOf } from "@/lib/brain/ingest/phase";
import { ingestLimitDkk } from "@/lib/brain/ingest/estimate";
import { maxPagesOf } from "@/lib/brain/ingest/limits";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Language } from "@/lib/i18n/language";
import { userMessage } from "@/lib/errors/user-message";

type Trust = "customer_doc" | "company_claim";
const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md";

/** The message of an error from a server function (meant for the user), else a fallback. */
function messageOf(cause: unknown, fallback: string, language: Language): string {
  return userMessage(cause, fallback, language);
}

export function BrainSources({ fundId }: { fundId: string }) {
  const t = useT();
  const language = useLanguage();
  const messageOfError = (cause: unknown) =>
    messageOf(cause, t("brainKnowledge.sources.failed"), language);
  const trustOptions = [
    { value: "customer_doc", label: t("brainKnowledge.sources.trustOwn") },
    { value: "company_claim", label: t("brainKnowledge.sources.trustCompany") },
  ] as const;
  const queryClient = useQueryClient();
  const list = useServerFn(listBrainSources);
  const requestUpload = useServerFn(requestBrainUpload);
  const completeUpload = useServerFn(completeBrainUpload);
  const submitText = useServerFn(submitBrainText);
  const submitWebsite = useServerFn(submitBrainWebsite);
  const approve = useServerFn(approveBrainIngest);
  const retry = useServerFn(retryBrainIngest);
  const download = useServerFn(getBrainSourceDownloadUrl);
  const forget = useServerFn(forgetBrainSource);

  const [trust, setTrust] = useState<Trust>("customer_doc");
  const [mode, setMode] = useState<"fil" | "tekst" | "hjemmeside">("fil");
  const [website, setWebsite] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [forgetTarget, setForgetTarget] = useState<BrainSourceRow | null>(null);
  const [suggested, setSuggested] = useState<Record<string, number | null>>({});
  const [pages, setPages] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const sources = useQuery({
    queryKey: ["brain-sources", fundId],
    queryFn: () => list({ data: { fundId } }),
    // Poll while anything is being read or waits in the queue.
    refetchInterval: (query) =>
      query.state.data?.sources.some((source) =>
        ["working", "queued", "uploading"].includes(source.phase),
      )
        ? 3000
        : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["brain-sources", fundId] });
  const canEdit = sources.data?.canEdit ?? false;

  const afterComplete = (result: Awaited<ReturnType<typeof completeUpload>>) => {
    if (result.status === "duplicate") {
      showToast({
        message: t("brainKnowledge.sources.exists", { title: result.existing.title }),
        tone: "error",
      });
    } else {
      setSuggested((current) => ({ ...current, [result.sourceId]: result.suggestedPages }));
      showToast({ message: t("brainKnowledge.sources.fileReady") });
    }
    void refresh();
  };

  const upload = async (file: File) => {
    setBusy(t("brainKnowledge.sources.uploading", { name: file.name }));
    try {
      const ticket = await requestUpload({
        data: {
          fundId,
          fileName: file.name,
          sizeBytes: file.size,
          trustTier: trust,
          ...(title.trim() ? { title: title.trim() } : {}),
        },
      });
      const { error } = await supabase.storage
        .from(BRAIN_SOURCES_BUCKET)
        .uploadToSignedUrl(
          ticket.path,
          ticket.token,
          file,
          file.type ? { contentType: file.type } : undefined,
        );
      if (error) throw new Error(t("brainKnowledge.sources.uploadFailed"));
      setBusy(t("brainKnowledge.sources.checking", { name: file.name }));
      afterComplete(await completeUpload({ data: { fundId, sourceId: ticket.sourceId } }));
      setTitle("");
    } catch (cause) {
      showToast({ message: messageOfError(cause), tone: "error" });
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  const sendText = async () => {
    setBusy(t("brainKnowledge.sources.savingText"));
    try {
      afterComplete(
        await submitText({ data: { fundId, title: title.trim(), text, trustTier: trust } }),
      );
      setText("");
      setTitle("");
    } catch (cause) {
      showToast({ message: messageOfError(cause), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const sendWebsite = async () => {
    setBusy(t("brainKnowledge.sources.readingSite"));
    try {
      const result = await submitWebsite({ data: { fundId, url: website.trim() } });
      if (result.complete.status === "duplicate") {
        showToast({
          message: t("brainKnowledge.sources.exists", { title: result.complete.existing.title }),
          tone: "error",
        });
      } else {
        const { sourceId, suggestedPages } = result.complete;
        setSuggested((current) => ({ ...current, [sourceId]: suggestedPages }));
        setOpen(sourceId);
        showToast({
          message:
            t("brainKnowledge.sources.pagesFetched", { count: result.pages }) +
            (result.portfolio > 0
              ? ` ${t("brainKnowledge.sources.portfolioWaiting", { count: result.portfolio })}`
              : ""),
        });
        setWebsite("");
      }
      void refresh();
    } catch (cause) {
      showToast({ message: messageOfError(cause), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const approveMutation = useMutation({
    mutationFn: (input: { sourceId: string; pageLimit?: number }) =>
      approve({ data: { fundId, ...input } }),
    onSuccess: () => {
      showToast({ message: t("brainKnowledge.sources.readStarted") });
      void refresh();
    },
    onError: (cause) => showToast({ message: messageOfError(cause), tone: "error" }),
  });
  const retryMutation = useMutation({
    mutationFn: (sourceId: string) => retry({ data: { fundId, sourceId } }),
    onSuccess: () => {
      showToast({ message: t("brainKnowledge.sources.retrying") });
      void refresh();
    },
    onError: (cause) => showToast({ message: messageOfError(cause), tone: "error" }),
  });
  const forgetMutation = useMutation({
    mutationFn: (sourceId: string) => forget({ data: { fundId, sourceId } }),
    onSuccess: (result) => {
      setForgetTarget(null);
      showToast({
        message: t("brainKnowledge.sources.forgotten", {
          episodes: result.episodes,
          facts: result.factsDeleted,
        }),
      });
      void refresh();
    },
    onError: (cause) => showToast({ message: messageOfError(cause), tone: "error" }),
  });

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && canEdit && !busy) void upload(file);
  };

  const openFile = async (source: BrainSourceRow) => {
    try {
      const { url } = await download({ data: { fundId, sourceId: source.id } });
      window.open(url, "_blank", "noopener");
    } catch (cause) {
      showToast({ message: messageOfError(cause), tone: "error" });
    }
  };

  if (sources.isLoading) return <LoadingState title={t("brainKnowledge.sources.loading")} />;
  if (sources.isError) return <ErrorState onRetry={() => void sources.refetch()} />;
  const rows = sources.data?.sources ?? [];

  return (
    <div className="flex flex-col gap-8">
      {canEdit && (
        <section
          aria-label={t("brainKnowledge.sources.giveMaterial")}
          className={cn(
            "flex flex-col gap-4 rounded-lg bg-canvas p-5 shadow-[inset_0_0_0_1.5px_var(--line-strong)] transition-shadow",
            dragging && "shadow-[inset_0_0_0_1.5px_var(--action)]",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              aria-label={t("brainKnowledge.sources.type")}
              size="sm"
              options={[
                { value: "fil", label: t("brainKnowledge.sources.modeFile") },
                { value: "tekst", label: t("brainKnowledge.sources.modeText") },
                { value: "hjemmeside", label: t("brainKnowledge.sources.modeSite") },
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode !== "hjemmeside" && (
              <SegmentedControl
                aria-label={t("brainKnowledge.sources.whoWrote")}
                size="sm"
                options={trustOptions}
                value={trust}
                onChange={setTrust}
              />
            )}
          </div>
          {mode === "hjemmeside" ? (
            <div className="flex flex-col gap-3">
              <input
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && website.trim() && !busy) void sendWebsite();
                }}
                placeholder={t("brainKnowledge.sources.sitePlaceholder")}
                aria-label={t("brainKnowledge.sources.siteLabel")}
                inputMode="url"
                maxLength={2_000}
                className="h-10 max-w-[480px] rounded-pill bg-sunken px-4 text-[14px] text-ink-1 outline-none focus:bg-surface focus:ring-2 focus:ring-action"
              />
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  variant="primary"
                  size="md"
                  disabled={Boolean(busy) || !website.trim()}
                  onClick={() => void sendWebsite()}
                >
                  <Globe className="size-4" aria-hidden /> {t("brainKnowledge.sources.fetchSite")}
                </Button>
                <p className="m-0 max-w-[520px] text-meta text-ink-3">
                  {busy ?? t("brainKnowledge.sources.siteHint")}
                </p>
              </div>
            </div>
          ) : (
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                mode === "tekst"
                  ? t("brainKnowledge.sources.titleRequired")
                  : t("brainKnowledge.sources.titleOptional")
              }
              aria-label={t("brainKnowledge.sources.titleLabel")}
              maxLength={500}
              className="h-10 max-w-[480px] rounded-pill bg-sunken px-4 text-[14px] text-ink-1 outline-none focus:bg-surface focus:ring-2 focus:ring-action"
            />
          )}
          {mode === "hjemmeside" ? null : mode === "fil" ? (
            <div className="flex flex-wrap items-center gap-4">
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(file);
                }}
              />
              <Button
                variant="primary"
                size="md"
                disabled={Boolean(busy)}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="size-4" aria-hidden /> {t("brainKnowledge.sources.chooseFile")}
              </Button>
              <p className="m-0 max-w-[520px] text-meta text-ink-3">
                {busy ?? t("brainKnowledge.sources.fileHint")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
                maxLength={60_000}
                aria-label={t("brainKnowledge.sources.textLabel")}
                placeholder={t("brainKnowledge.sources.textPlaceholder")}
                className="w-full max-w-[720px] resize-y rounded-lg bg-surface p-3 text-[14px] text-ink-1 outline-none focus:ring-2 focus:ring-action"
              />
              <div>
                <Button
                  variant="primary"
                  size="md"
                  disabled={Boolean(busy) || !text.trim() || !title.trim()}
                  onClick={() => void sendText()}
                >
                  {t("brainKnowledge.sources.saveText")}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={t("brainKnowledge.sources.emptyTitle")}
          body={t("brainKnowledge.sources.emptyBody")}
        />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((source) => (
            <SourceRow
              key={source.id}
              fundId={fundId}
              source={source}
              canEdit={canEdit}
              canForget={sources.data?.canForget ?? false}
              expanded={open === source.id}
              onToggle={() => setOpen(open === source.id ? null : source.id)}
              suggestedPages={suggested[source.id] ?? null}
              pages={pages[source.id] ?? ""}
              onPages={(value) => setPages((current) => ({ ...current, [source.id]: value }))}
              onApprove={(pageLimit) =>
                approveMutation.mutate({ sourceId: source.id, ...(pageLimit ? { pageLimit } : {}) })
              }
              onRetry={() => retryMutation.mutate(source.id)}
              onDownload={() => void openFile(source)}
              onForget={() => setForgetTarget(source)}
              pending={approveMutation.isPending || retryMutation.isPending}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={forgetTarget !== null}
        onOpenChange={(value) => !value && setForgetTarget(null)}
        title={t("brainKnowledge.sources.forgetTitle", { title: forgetTarget?.title ?? "" })}
        description={t("brainKnowledge.sources.forgetBody")}
        icon={Trash2}
        footer={
          <>
            <Button variant="quiet" size="md" onClick={() => setForgetTarget(null)}>
              {t("brainKnowledge.sources.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              pending={forgetMutation.isPending}
              onClick={() => forgetTarget && forgetMutation.mutate(forgetTarget.id)}
            >
              {t("brainKnowledge.sources.forgetConfirm")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function SourceRow({
  fundId,
  source,
  canEdit,
  canForget,
  expanded,
  onToggle,
  suggestedPages,
  pages,
  onPages,
  onApprove,
  onRetry,
  onDownload,
  onForget,
  pending,
}: {
  fundId: string;
  source: BrainSourceRow;
  canEdit: boolean;
  canForget: boolean;
  expanded: boolean;
  onToggle: () => void;
  suggestedPages: number | null;
  pages: string;
  onPages: (value: string) => void;
  onApprove: (pageLimit?: number) => void;
  onRetry: () => void;
  onDownload: () => void;
  onForget: () => void;
  pending: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const limitDkk = ingestLimitDkk(source.kind);
  const isWebsite = source.kind === "website";
  const over = source.maxDkk !== null && source.maxDkk > limitDkk;
  const period = formatPeriod(source.periodStart, source.periodEnd, language);
  const meta = [
    kindLabel(source.kind, language) ?? source.kind,
    source.docType ? docTypeLabel(source.docType, language) : null,
    trustLabel(source.trustTier, language),
    source.pageCount
      ? t(
          source.pageCount === 1
            ? "brainKnowledge.sources.pagesOne"
            : "brainKnowledge.sources.pagesMany",
          { count: source.pageCount },
        )
      : null,
    formatBytes(source.sizeBytes, language) || null,
    period,
  ].filter(Boolean);
  const stepLabel = source.step ? stepLabelOf(source.step, language) : null;
  const failedStepLabel = source.failedStep ? stepLabelOf(source.failedStep, language) : undefined;
  const pageLimit = Number(pages || suggestedPages || 0);

  return (
    <li className="flex flex-col gap-2 border-b border-line py-4 first:pt-0">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] bg-sunken text-ink-3">
          {isWebsite ? (
            <Globe className="size-[17px]" aria-hidden />
          ) : (
            <FileText className="size-[17px]" aria-hidden />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button
            type="button"
            onClick={onToggle}
            className="m-0 truncate border-0 bg-transparent p-0 text-left text-[15px] font-medium text-ink-1"
            aria-expanded={expanded}
          >
            {source.title}
          </button>
          <p className="m-0 text-meta text-ink-3">{meta.join(" · ")}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span
            className={cn(
              "text-meta font-medium",
              source.phase === "failed"
                ? "text-critical"
                : source.phase === "ready"
                  ? "text-positive"
                  : "text-ink-2",
            )}
          >
            {phaseLabel(source.phase, language)}
            {source.phase === "working" && stepLabel ? ` · ${stepLabel}` : ""}
          </span>
        </div>
      </div>

      {(source.phase === "working" || source.phase === "queued") && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(source.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 overflow-hidden rounded-pill bg-sunken"
        >
          <div
            className="h-full rounded-pill bg-ai transition-[width] duration-500"
            style={{ width: `${Math.max(source.progress, 0.04) * 100}%` }}
          />
        </div>
      )}

      {source.phase === "failed" && source.errorMessage && (
        <p className="m-0 text-meta text-critical">
          {source.errorMessage}
          {failedStepLabel
            ? ` ${t("brainKnowledge.sources.atStep", { step: failedStepLabel })}`
            : ""}
        </p>
      )}
      {source.phase === "review" && (
        <p className="m-0 text-meta text-ink-2">
          {source.warnings.at(-1) ?? t("brainKnowledge.sources.needsAction")}
        </p>
      )}

      {source.phase === "awaiting_approval" && source.maxDkk !== null && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-canvas px-4 py-3">
          <p className="m-0 text-[14px] text-ink-1">{t("brainKnowledge.sources.approveIntro")}</p>
          {over && (
            <p className="m-0 w-full text-meta text-ink-3">
              {t("brainKnowledge.sources.tooMuch", {
                target: isWebsite
                  ? t("brainKnowledge.sources.aWebsite")
                  : t("brainKnowledge.sources.aDocument"),
              })}
            </p>
          )}
          {over && (
            <label className="flex items-center gap-2 text-meta text-ink-2">
              {t("brainKnowledge.sources.first")}
              <input
                type="number"
                min={1}
                max={maxPagesOf(source.kind)}
                value={pages || (suggestedPages ?? "")}
                onChange={(event) => onPages(event.target.value)}
                className="h-8 w-[72px] rounded-pill bg-sunken px-3 text-[13px] outline-none focus:ring-2 focus:ring-action"
              />
              {t("brainKnowledge.sources.pagesUnit")}
            </label>
          )}
          {canEdit && (
            <Button
              variant="primary"
              size="sm"
              disabled={pending || (over && !(pageLimit >= 1))}
              onClick={() => onApprove(over ? pageLimit : undefined)}
            >
              {over
                ? t("brainKnowledge.sources.readFirst")
                : t("brainKnowledge.sources.approveAndRead")}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {source.phase === "failed" && canEdit && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={onRetry}>
            <RotateCcw className="size-3.5" aria-hidden />
            {failedStepLabel
              ? t("brainKnowledge.sources.retryFrom", { step: failedStepLabel })
              : t("brainKnowledge.sources.retry")}
          </Button>
        )}
        {canEdit && source.phase !== "uploading" && (
          <Button variant="quiet" size="sm" onClick={onDownload}>
            <Download className="size-3.5" aria-hidden /> {t("brainKnowledge.sources.download")}
          </Button>
        )}
        {canForget && (
          <Button variant="danger" size="sm" onClick={onForget}>
            <Trash2 className="size-3.5" aria-hidden /> {t("brainKnowledge.sources.forget")}
          </Button>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 rounded-lg bg-canvas px-4 py-3 text-[14px] text-ink-2">
          {source.summary ? (
            <p className="m-0">{source.summary}</p>
          ) : (
            <p className="m-0 text-ink-3">{t("brainKnowledge.sources.noSummary")}</p>
          )}
          {source.warnings.length > 0 && (
            <ul className="m-0 list-disc pl-5 text-meta text-ink-3">
              {source.warnings.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {isWebsite && <WebsitePortfolio fundId={fundId} sourceId={source.id} />}
          <p className="m-0 text-micro text-ink-4">
            {source.chunkCount
              ? `${t("brainKnowledge.sources.chunks", { count: source.chunkCount })} · `
              : ""}
            {source.fileName ?? ""} {t("brainKnowledge.sources.uploadedOn")}{" "}
            {new Date(source.createdAt).toLocaleDateString(localeTag)}
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * The portfolio companies found on the fund's website are only proposals. An Admin ticks
 * the right ones and confirms; they then count as "investeret" in the fund's decision history.
 */
function WebsitePortfolio({ fundId, sourceId }: { fundId: string; sourceId: string }) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const load = useServerFn(getWebsitePortfolio);
  const confirm = useServerFn(confirmWebsitePortfolio);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const portfolio = useQuery({
    queryKey: ["brain-website-portfolio", fundId, sourceId],
    queryFn: () => load({ data: { fundId, sourceId } }),
  });
  const companies = portfolio.data?.companies ?? [];
  const open = companies.filter((company) => !company.confirmed);
  // Nothing is ticked in advance: the Admin picks the companies that really are the portfolio.
  const selected = chosen ?? new Set<string>();
  const allSelected = open.length > 0 && open.every((company) => selected.has(company.domain));
  const confirmMutation = useMutation({
    mutationFn: () => confirm({ data: { fundId, sourceId, domains: [...selected] } }),
    onSuccess: (result) => {
      setChosen(null);
      showToast({
        message: t("brainKnowledge.sources.portfolioSaved", { count: result.inserted }),
      });
      void queryClient.invalidateQueries({
        queryKey: ["brain-website-portfolio", fundId, sourceId],
      });
    },
    onError: (cause) =>
      showToast({
        message: messageOf(cause, t("brainKnowledge.sources.failed"), language),
        tone: "error",
      }),
  });

  if (portfolio.isLoading)
    return (
      <p className="m-0 text-meta text-ink-3">{t("brainKnowledge.sources.loadingPortfolio")}</p>
    );
  if (portfolio.isError || companies.length === 0) {
    return (
      <p className="m-0 text-meta text-ink-3">
        {portfolio.isError
          ? t("brainKnowledge.sources.portfolioError")
          : t("brainKnowledge.sources.portfolioNone")}
      </p>
    );
  }
  const canConfirm = portfolio.data?.canConfirm ?? false;
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[14px] font-medium text-ink-1">
        {t("brainKnowledge.sources.portfolioTitle")}
        {open.length > 0
          ? ` ${t("brainKnowledge.sources.portfolioProposals", { count: open.length })}`
          : ""}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {companies.map((company) => (
          <li key={company.domain} className="flex items-center gap-2 text-meta text-ink-2">
            {company.confirmed ? (
              <Check
                className="size-3.5 text-positive"
                aria-label={t("brainKnowledge.sources.confirmed")}
              />
            ) : (
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-[var(--action)]"
                aria-label={t("brainKnowledge.sources.choose", { name: company.name })}
                disabled={!canConfirm}
                checked={selected.has(company.domain)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(company.domain);
                  else next.delete(company.domain);
                  setChosen(next);
                }}
              />
            )}
            <span className="text-ink-1">{company.name}</span>
            <span className="text-ink-4">{company.domain}</span>
          </li>
        ))}
      </ul>
      {open.length > 0 &&
        (canConfirm ? (
          <div className="flex flex-wrap gap-1">
            <Button
              variant="quiet"
              size="sm"
              onClick={() =>
                setChosen(new Set(allSelected ? [] : open.map((company) => company.domain)))
              }
            >
              {allSelected
                ? t("brainKnowledge.sources.deselectAll")
                : t("brainKnowledge.sources.selectAll")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.size === 0}
              pending={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
            >
              {t("brainKnowledge.sources.confirmInvested", { count: selected.size })}
            </Button>
          </div>
        ) : (
          <p className="m-0 text-meta text-ink-3">{t("brainKnowledge.sources.adminConfirms")}</p>
        ))}
    </div>
  );
}

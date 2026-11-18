/**
 * Login and invitation frame (invitation.dc.html): Velaris
 * fills the screen, a centred 420 px column with the logo (26 px mark, 20/600 name), a
 * glass card (radius 28, 86 % surface, blur 20 and saturate 1.2, padding 30/28/26, gap 20)
 * and the security line under it. Motion (which wins over the prototype's 16 px / 640 ms): the logo
 * fades in, the card rises 12 px over 520 ms after 60 ms, the
 * security line fades in after 300 ms; all done within ~900 ms.
 *
 * The fields, the password strength meter, the 52 px button and the states (error, link no
 * longer valid, done) are measured in the same prototype.
 */
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Clock, Eye, EyeOff, LockKeyhole, RotateCw } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { Velaris } from "@/components/ds/Velaris";
import { Button } from "@/components/ds/Button";
import { DURATION, EASE, PRESS, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey, TranslateVars } from "@/lib/i18n/translate";

/** How long the green check shows before Overblik opens (the prototype's 1,4 s). */
export const DONE_DELAY_MS = 1400;

export function AuthScreen({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const t = useT();
  const fade = (delay: number, duration: number) =>
    reduced ? REDUCED_FADE : { duration, ease: EASE.out, delay };
  return (
    <div className="relative isolate flex min-h-screen overflow-auto bg-canvas text-ink-1">
      <Velaris className="inset-0 -z-10" style={{ position: "fixed" }} />
      <div className="flex w-full flex-col items-center px-5 py-8">
        <div className="my-auto flex w-full max-w-[420px] flex-col gap-[18px]">
          <motion.div
            className="flex items-center justify-center gap-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={fade(0, 0.52)}
          >
            <InterlectMark size={26} />
            <span className="text-[20px] font-semibold tracking-[-0.02em]">Interlect</span>
          </motion.div>
          <motion.div
            className="flex flex-col gap-5 rounded-[28px] bg-[color-mix(in_oklab,var(--bg-surface)_86%,transparent)] px-7 pt-[30px] pb-[26px] shadow-[0_1px_2px_rgba(23,21,28,.05),0_30px_80px_-30px_rgba(23,21,28,.3)] backdrop-blur-[20px] backdrop-saturate-[1.2]"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={fade(0.06, 0.52)}
          >
            {children}
          </motion.div>
          <motion.div
            className="flex items-start gap-2.5 px-2.5 text-meta leading-[1.5] text-ink-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={fade(0.3, 0.52)}
          >
            <LockKeyhole
              className="mt-[3px] size-3 shrink-0 text-positive"
              strokeWidth={1.75}
              aria-hidden
            />
            <span>{t("auth.frame.security")}</span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/** Title block: optional small line above, 28/600 title, optional 15 px ink-3 line under. */
export function AuthHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {eyebrow && <span className="text-list text-ink-3">{eyebrow}</span>}
      <h1 className="m-0 text-[28px] leading-[1.15] font-semibold tracking-title">{title}</h1>
      {subtitle && <span className="text-[15px] text-ink-3">{subtitle}</span>}
    </div>
  );
}

const inputClass =
  "h-[50px] w-full min-w-0 rounded-md bg-surface px-4 text-[16px] text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none transition-shadow duration-[var(--dur-quick)] placeholder:text-ink-4 focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]";

export function AuthField({
  label,
  className,
  id,
  invalid = false,
  errorId,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  /** Marks the field for screen readers when the form's error is about it. */
  invalid?: boolean;
  errorId?: string | undefined;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5">
      <span className="text-list font-medium">{label}</span>
      <input
        id={inputId}
        className={cn(inputClass, className)}
        {...(invalid ? { "aria-invalid": true } : {})}
        {...(invalid && errorId ? { "aria-describedby": errorId } : {})}
        {...props}
      />
    </label>
  );
}

/** 12 characters minimum (acceptInvitationAsNewUser); 16 or more reads as strong. */
export const MIN_PASSWORD_LENGTH = 12;

function strength(length: number): {
  level: number;
  text: [MessageKey, TranslateVars?];
  short: boolean;
} {
  const level = length >= 16 ? 3 : length >= MIN_PASSWORD_LENGTH ? 2 : length > 0 ? 1 : 0;
  const text: [MessageKey, TranslateVars?] =
    length === 0
      ? ["auth.frame.minLength", { count: MIN_PASSWORD_LENGTH }]
      : length < MIN_PASSWORD_LENGTH
        ? ["auth.frame.moreChars", { count: MIN_PASSWORD_LENGTH - length }]
        : level === 3
          ? ["auth.frame.strong"]
          : ["auth.frame.good"];
  return { level, text, short: length > 0 && length < MIN_PASSWORD_LENGTH };
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  meter = false,
  invalid = false,
  errorId,
  inputRef,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  /** Strength meter under the field (new password). */
  meter?: boolean;
  /** Marks the field for screen readers when the form's error is about it. */
  invalid?: boolean;
  /** Id of the error line, read together with the field when it is invalid. */
  errorId?: string | undefined;
  /** Lets the page move focus here, e.g. when the e-mail came filled in from interlect.ai. */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [visible, setVisible] = useState(false);
  const t = useT();
  const id = useId();
  const hintId = `${id}-hint`;
  const s = strength(value.length);
  const describedBy = [meter ? hintId : null, invalid && errorId ? errorId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-list font-medium">
        {label}
      </label>
      <span className="relative flex">
        <input
          ref={inputRef}
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          maxLength={200}
          {...(meter ? { minLength: MIN_PASSWORD_LENGTH } : {})}
          {...(describedBy ? { "aria-describedby": describedBy } : {})}
          {...(invalid ? { "aria-invalid": true } : {})}
          className={cn(inputClass, "flex-1 pr-12")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("auth.frame.hidePassword") : t("auth.frame.showPassword")}
          title={visible ? t("auth.frame.hidePassword") : t("auth.frame.showPassword")}
          aria-pressed={visible}
          className="absolute top-[9px] right-2 grid size-8 place-items-center rounded-full text-ink-3 transition-colors hover:bg-hover"
        >
          {visible ? (
            <EyeOff className="size-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <Eye className="size-4" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </span>
      {meter && (
        <span className="flex items-center gap-2.5 pt-1">
          <span className="flex h-1 flex-1 gap-1" aria-hidden>
            {[1, 2, 3].map((k) => (
              <span
                key={k}
                className="flex-1 rounded-[2px] transition-colors duration-300"
                style={{
                  background:
                    s.level >= k
                      ? s.level === 1
                        ? "var(--warning)"
                        : "var(--positive)"
                      : "var(--chart-track)",
                }}
              />
            ))}
          </span>
          <span
            id={hintId}
            className={cn("text-meta whitespace-nowrap", s.short ? "text-warning" : "text-ink-3")}
          >
            {t(...s.text)}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * The 52 px primary pill; ink-4 until the form can be sent. While waiting the label
 * crossfades to the ink orb and the pending text ("Knapper"), like ds `Button`.
 */
export function AuthButton({
  children,
  ready,
  pending,
  pendingLabel,
  type = "submit",
  onClick,
}: {
  children: ReactNode;
  ready: boolean;
  pending: boolean;
  pendingLabel: string;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type={type}
      onClick={onClick}
      aria-disabled={!ready || pending || undefined}
      aria-busy={pending || undefined}
      {...(reduced || pending ? {} : { whileTap: PRESS.whileTap })}
      transition={PRESS.transition}
      className="grid h-[52px] items-center rounded-pill text-[15px] font-medium text-ink-inverse transition-colors duration-[var(--dur-base)] outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      style={{ background: ready || pending ? "var(--bg-inverse)" : "var(--ink-4)" }}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={pending ? "pending" : "idle"}
          className="col-start-1 row-start-1 inline-flex items-center justify-center gap-2.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.quick, ease: EASE.out }}
        >
          {pending && <AiOrb size={20} tone="neutral" state="working" onDark />}
          {pending ? pendingLabel : children}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

export function AuthError({ children, id }: { children: ReactNode; id?: string | undefined }) {
  return (
    <motion.span
      id={id}
      role="alert"
      className="flex items-center gap-2 text-list text-critical"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
    >
      <CircleAlert className="size-[13px] shrink-0" strokeWidth={1.75} aria-hidden />
      {children}
    </motion.span>
  );
}

/** Centred result with a tile that pops in (link no longer valid, done). */
function AuthResult({
  tile,
  title,
  body,
  children,
}: {
  tile: ReactNode;
  title: ReactNode;
  body: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3.5 py-2.5 text-center">
      {tile}
      <h1 className="m-0 text-[24px] font-semibold tracking-title">{title}</h1>
      <span className="text-[15px] leading-[1.55] text-ink-3">{body}</span>
      {children}
    </div>
  );
}

function Pop({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduced ? REDUCED_FADE : SPRING.snappy}
    >
      {children}
    </motion.span>
  );
}

export function AuthExpired({
  onLogin,
  title,
  body,
}: {
  onLogin: () => void;
  /** Another link's own words (the password link); the invitation's by default. */
  title?: string;
  body?: string;
}) {
  const t = useT();
  return (
    <AuthResult
      tile={
        <Pop>
          <span className="grid size-14 place-items-center rounded-[16px] bg-warning-wash text-warning">
            <Clock className="size-[22px]" strokeWidth={1.75} aria-hidden />
          </span>
        </Pop>
      }
      title={title ?? t("auth.frame.expiredTitle")}
      body={body ?? t("auth.frame.expiredBody")}
    >
      <Button variant="secondary" size="lg" onClick={onLogin}>
        {t("auth.frame.toLogin")}
      </Button>
    </AuthResult>
  );
}

/** The invitation could not be fetched (network, rate limit): nothing about the link itself. */
export function AuthLoadError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <AuthResult
      tile={
        <Pop>
          <span className="grid size-14 place-items-center rounded-[16px] bg-sunken text-ink-3">
            <RotateCw className="size-[22px]" strokeWidth={1.75} aria-hidden />
          </span>
        </Pop>
      }
      title={t("auth.frame.loadErrorTitle")}
      body={t("auth.frame.loadErrorBody")}
    >
      <Button variant="secondary" size="lg" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </AuthResult>
  );
}

/** The access exists, but signing in right after failed: log in by hand. */
export function AuthCreated({
  onLogin,
  title,
  body,
}: {
  onLogin: () => void;
  title?: string;
  body?: string;
}) {
  const t = useT();
  return (
    <AuthResult
      tile={
        <Pop>
          <span className="grid size-16 place-items-center rounded-full bg-positive text-ink-inverse">
            <Check className="size-7" strokeWidth={2} aria-hidden />
          </span>
        </Pop>
      }
      title={title ?? t("auth.frame.createdTitle")}
      body={body ?? t("auth.frame.createdBody")}
    >
      <Button variant="primary" size="lg" onClick={onLogin}>
        {t("auth.frame.toLogin")}
      </Button>
    </AuthResult>
  );
}

export function AuthDone({ title }: { title: string }) {
  const t = useT();
  return (
    <div role="status" className="flex flex-col items-center gap-3.5 py-2.5 text-center">
      <Pop>
        <span className="grid size-16 place-items-center rounded-full bg-positive text-ink-inverse">
          <Check className="size-7" strokeWidth={2} aria-hidden />
        </span>
      </Pop>
      <h1 className="m-0 text-[26px] font-semibold tracking-title">{title}</h1>
      <span className="text-[15px] text-ink-3">{t("auth.frame.redirecting")}</span>
    </div>
  );
}

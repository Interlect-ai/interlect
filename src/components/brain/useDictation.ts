/**
 * The microphone in Brain's composer: the browser's own speech-to-text (Web Speech API),
 * no new subcontractor of ours. The recognised words are added to the draft as they settle; the
 * page's language decides the recognition language. Unsupported browsers get no microphone.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const noop = () => () => undefined;

export function useDictation({
  lang,
  onText,
  onError,
}: {
  /** BCP 47 tag, e.g. "da-DK". */
  lang: string;
  /** A settled phrase. */
  onText: (phrase: string) => void;
  onError: (reason: "denied" | "failed") => void;
}) {
  // Known only in the browser; the server renders without the microphone.
  const supported = useSyncExternalStore(
    noop,
    () => recognitionCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onError });
  handlers.current = { onText, onError };

  useEffect(() => () => recognition.current?.abort(), []);

  const toggle = useCallback(() => {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const next = new Ctor();
    next.lang = lang;
    next.continuous = true;
    next.interimResults = false;
    next.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) handlers.current.onText(result[0].transcript);
      }
    };
    next.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      handlers.current.onError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "denied"
          : "failed",
      );
    };
    next.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = next;
    try {
      next.start();
      setListening(true);
    } catch {
      recognition.current = null;
      handlers.current.onError("failed");
    }
  }, [lang]);

  return { supported, listening, toggle };
}

/**
 * The case building blocks on /intern/komponenter: Mandatfit circles, "Skal afklares",
 * Filer, Beskeder with a Brain answer, and the AI composer in its three sizes. Content is
 * the Screening v5 / Brain prototypes' example (Havbrug Nord); interactions change only this
 * page's local state.
 */
import { useState, type ReactNode } from "react";
import { FileText, Gavel, Sparkles } from "lucide-react";
import { MandatfitCircles } from "@/components/ds/MandatfitCircles";
import { TaskList } from "@/components/ds/TaskList";
import type {
  TaskAnswer,
  TaskAnswerInput,
  TaskItem,
  TaskLink,
  TaskPerson,
} from "@/components/ds/task-types";
import { FileList, type FileListItem } from "@/components/ds/FileList";
import { ChatThread, type ChatItem } from "@/components/ds/ChatThread";
import { AiComposer } from "@/components/ds/AiComposer";
import { showToast } from "@/components/ds/Toast";

/** The page's local stand-in for "save the answer" (the real pages call answerTask). */
function toAnswer(input: TaskAnswerInput): TaskAnswer {
  switch (input.kind) {
    case "text":
      return { text: input.text };
    case "number":
      return { number: input.number };
    case "select":
      return { option: input.option };
    case "file":
      return { fileName: input.file.name };
    case "gate":
      return { gatePassed: input.passed, text: input.text || null };
  }
}

function Block({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-7">
      <div className="flex max-w-[640px] flex-col gap-2">
        <h2 className="m-0 text-page leading-[1.1] font-semibold tracking-title">{title}</h2>
        <p className="m-0 text-body text-ink-3">{intro}</p>
      </div>
      {children}
    </section>
  );
}

const GATES = [
  { key: "geo", label: "Norden", status: "passed" },
  { key: "stage", label: "Seed eller Serie A", status: "passed" },
  { key: "sector", label: "Klima og fødevarer", status: "passed" },
  { key: "ticket", label: "Ticket 2–8 mio. kr.", status: "passed" },
  { key: "team", label: "Fuldtidsteam", status: "passed" },
  { key: "ip", label: "Ejer egen teknologi", status: "passed" },
  { key: "esg", label: "Ingen udelukkede aktiviteter", status: "passed" },
  { key: "owner", label: "Ejerandel mindst 10 %", status: "unknown" },
  { key: "runway", label: "Runway mindst 12 mdr.", status: "unknown" },
] as const;

const ME: TaskPerson = { id: "me", name: "Maja Holm", description: "Dig, Lead", isMe: true };
const JONAS: TaskPerson = { id: "jonas", name: "Jonas Berg", description: "Medlem" };
const INTERLECT: TaskPerson = {
  id: "interlect",
  name: "Interlect",
  description: "Finder det selv",
  isInterlect: true,
};
const PEOPLE = [ME, JONAS, INTERLECT];
const LINKS: TaskLink[] = [
  { kind: "gate", key: "owner", label: "Mandatfit, Ejerandel mindst 10 %", color: "var(--action)" },
  { kind: "criterion", key: "traction", label: "Traction", color: "var(--series-6)" },
  { kind: "criterion", key: "team", label: "Team", color: "var(--series-2)" },
];

const TASKS: TaskItem[] = [
  {
    id: "t1",
    kind: "question",
    title: "Værdiansættelse før runden",
    description: "Pre-money værdiansættelse i den runde, fonden overvejer at deltage i.",
    why: "Afgør ejerandelen og dermed gaten Ejerandel mindst 10 %.",
    answerKind: "number",
    answerUnit: "mio. kr.",
    answerLabel: "Pre-money i mio. kr.",
    assignee: ME,
    dueOn: "2026-10-02",
    link: LINKS[0]!,
    status: "open",
    source: "ai",
  },
  {
    id: "t2",
    kind: "verification",
    title: "Licensstatus i Norge",
    description: "Ekspansionsplanen forudsætter en norsk licens, som ikke er dokumenteret.",
    why: "Uden licens falder markedsplanen for 2027.",
    answerKind: "select",
    answerOptions: ["Licens givet", "Ansøgt", "Ikke ansøgt"],
    assignee: ME,
    dueOn: "2026-10-03",
    status: "open",
    source: "ai",
  },
  {
    id: "t3",
    kind: "verification",
    title: "Bekræft pipeline på 11 opdrættere",
    answerKind: "text",
    assignee: JONAS,
    link: LINKS[1]!,
    status: "open",
    source: "user",
  },
  {
    id: "t4",
    kind: "document",
    title: "Cap table efter konvertering",
    answerKind: "file",
    assignee: ME,
    dueOn: "2026-10-02",
    status: "open",
    source: "ai",
  },
  {
    id: "t5",
    kind: "research",
    title: "Find navngiven salgsleder",
    answerKind: "ai",
    assignee: INTERLECT,
    link: LINKS[2]!,
    status: "open",
    source: "ai",
  },
  {
    id: "t6",
    kind: "question",
    title: "Churn i piloten",
    answerKind: "number",
    answerUnit: "%",
    assignee: ME,
    status: "resolved",
    answer: { number: 0 },
    source: "ai",
  },
];

const FILES: FileListItem[] = [
  {
    id: "f1",
    fileName: "Havbrug Nord pitch deck 2026.pdf",
    uploadedBy: "Maja Holm",
    createdAt: "2026-09-18T09:12:00Z",
    link: { label: "Generelt" },
  },
  {
    id: "f2",
    fileName: "Cap table efter konvertering.xlsx",
    uploadedBy: "Jonas Berg",
    createdAt: "2026-09-26T14:30:00Z",
    link: { label: "Cap table efter konvertering", color: "var(--action)" },
  },
  {
    id: "f3",
    fileName: "Aftalememo Hirtshals.docx",
    uploadedBy: "Hentet af Interlect",
    createdAt: "2026-09-27T08:05:00Z",
    link: { label: "Traction", color: "var(--series-6)" },
  },
];

const THREAD: ChatItem[] = [
  {
    kind: "user",
    id: "m1",
    body: "Har nogen talt med dem om licensen i Norge?",
    authorName: "Jonas Berg",
    isMine: false,
    createdAt: "2026-09-27T09:02:00Z",
  },
  {
    kind: "user",
    id: "m2",
    body: "Ja, de har søgt i august. Svar ventes i november.",
    authorName: "Maja Holm",
    isMine: true,
    createdAt: "2026-09-27T09:10:00Z",
  },
  {
    kind: "system",
    id: "m3",
    body: "Maja Holm udfyldte Licensstatus i Norge: Ansøgt",
    icon: Sparkles,
    iconColor: "var(--ai)",
  },
  { kind: "question", id: "q1", body: "Hvorfor er runway kortere nu?", context: "Havbrug Nord" },
  {
    kind: "answer",
    id: "a1",
    status: "done",
    text: "Runway er faldet fra 14 til 11 måneder, fordi anlæg nummer fire er rykket frem til Q2, og det månedlige forbrug derfor stiger til ca. 0,74 mio. kr. Likviditeten er uændret 8,1 mio. kr.",
    sources: [
      { id: "s1", label: "Regnskab 2025", icon: FileText, color: "var(--series-8)" },
      { id: "s2", label: "Beslutning 18. sep", icon: Gavel, color: "var(--warning)" },
    ],
    onCopy: () => showToast({ message: "Svaret er kopieret" }),
    onSaveNote: () => showToast({ message: "Gemt som note på casen" }),
  },
];

export function CaseBlocksGallery() {
  const [tasks, setTasks] = useState(TASKS);
  const [composer, setComposer] = useState("");
  const [thread, setThread] = useState<ChatItem[]>(THREAD);

  return (
    <>
      <Block
        title="Mandatfit"
        intro="Gates som cirkler. Opfyldt er fyldt grøn, ukendt er en violet ring med ?, brud er fyldt rød. Størrelsen følger antallet af gates."
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-5 rounded-lg bg-canvas p-[22px]">
            <span className="text-list font-semibold">Mandatfit</span>
            <MandatfitCircles gates={GATES} />
            <span className="text-title font-semibold tracking-title">7 af 9</span>
          </div>
          <div className="flex min-w-0 flex-col gap-5 rounded-lg bg-surface p-[22px] shadow-card">
            <span className="text-list font-semibold">Fokus-side</span>
            <MandatfitCircles gates={GATES} variant="focus" />
          </div>
        </div>
      </Block>

      <Block
        title="Skal afklares"
        intro="Én liste pr. case, ens i screening og dyb analyse. Klik en række for at folde den ud; Udfyld svarer, … har flere muligheder."
      >
        <TaskList
          tasks={tasks}
          people={PEOPLE}
          links={LINKS}
          onCreate={async (draft) => {
            setTasks((current) => [
              ...current,
              {
                id: `new-${current.length}`,
                kind: draft.kind,
                title: draft.title,
                description: draft.description,
                answerKind: draft.answerKind,
                assignee: draft.assignee,
                dueOn: draft.dueOn,
                link: draft.link,
                status: "open",
                source: "user",
              },
            ]);
          }}
          onAnswer={async (task, answer) => {
            setTasks((current) =>
              current.map((t) =>
                t.id === task.id ? { ...t, status: "resolved", answer: toAnswer(answer) } : t,
              ),
            );
          }}
          onRename={async (task, title) => {
            setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, title } : t)));
          }}
          onReassign={async (task, person) => {
            setTasks((current) =>
              current.map((t) => (t.id === task.id ? { ...t, assignee: person } : t)),
            );
          }}
          onDelete={async (task) => {
            setTasks((current) => current.filter((t) => t.id !== task.id));
          }}
          onRestore={async (task) => {
            setTasks((current) => [...current, task]);
          }}
        />
      </Block>

      <Block
        title="Filer og beskeder"
        intro="Filer har upload, søgning og et stille typefilter. Beskeder: egne til højre i blæk, andres til venstre, systemlinjer centreret; Brain-svar har kilder som chips."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="min-w-0 rounded-lg bg-surface p-[22px] shadow-card">
            <FileList
              files={FILES}
              onDownload={(file) => showToast({ message: `Henter ${file.fileName}` })}
              onUpload={(files) =>
                showToast({ message: `${files.length} fil(er) klar til upload` })
              }
            />
          </div>
          <div className="flex h-[560px] min-w-0 flex-col overflow-hidden rounded-lg bg-canvas">
            <ChatThread
              items={thread}
              variant="panel"
              label="Beskeder"
              onSend={(text) =>
                setThread((current) => [
                  ...current,
                  {
                    kind: "user",
                    id: `m-${current.length}`,
                    body: text,
                    authorName: "Maja Holm",
                    isMine: true,
                    createdAt: new Date().toISOString(),
                  },
                ])
              }
            />
          </div>
        </div>
      </Block>

      <Block
        title="AI-composer"
        intro="Den store AI-indtastning i Opret case, fondsopsætningen og Brain. Pladsholderen skifter eksempel hvert 3,2 sekund."
      >
        <div className="flex flex-col gap-8 rounded-xl bg-canvas px-4 py-10 md:px-10">
          <AiComposer
            variant="fund"
            label="Skriv til Interlect"
            heading="Lad Interlect hjælpe med tesen"
            value={composer}
            onChange={setComposer}
            onSend={(text) => {
              setComposer("");
              showToast({ message: `Sendt: ${text.slice(0, 40)}` });
            }}
            placeholder={[
              "Fokusér mere på betalende kunder",
              "Vægt teamet højere i seed",
              "Tilføj en gate for ejerandel",
              "Gør økonomi til et kriterie",
              "Hvad betyder risikovilligheden?",
            ]}
            onAttach={() => undefined}
          />
          <AiComposer
            variant="brain"
            label="Spørg Brain"
            value=""
            onChange={() => undefined}
            onSend={() => undefined}
            placeholder="Spørg om jeres cases, noter og beslutninger"
            onAttach={() => undefined}
          />
        </div>
      </Block>
    </>
  );
}

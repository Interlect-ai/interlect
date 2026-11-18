/** Test af lektioner, indsigter og refleksioner som visning. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGREEMENT_LABEL,
  checkLessonText,
  evidenceSummary,
  groupLessons,
  helpfulShare,
  insightBulletId,
  lessonDate,
  scopeText,
  shapeEvent,
  shapeInsight,
  shapeLesson,
  shapeReflection,
} from "./lessons.ts";

const row = (extra: Record<string, unknown> = {}) => ({
  id: "b1",
  short_id: "pb-00001",
  section: "red_flags",
  text: "Ingen kunder efter to år",
  helpful: 3,
  harmful: 1,
  status: "active",
  origin: "brain",
  scope: { sektor: "fintech", nested: { x: 1 } },
  evidence: [{ kind: "decision" }, { kind: "case" }],
  ...extra,
});

test("lektion: felter, etiketter og sikre standardværdier", () => {
  const lesson = shapeLesson(row())!;
  assert.equal(lesson.sectionLabel, "Røde flag");
  assert.equal(lesson.statusLabel, "Aktiv");
  assert.equal(lesson.evidenceCount, 2);
  assert.equal(lesson.scopeText, "sektor: fintech");
  const odd = shapeLesson(row({ section: "findes_ikke", helpful: -4, origin: "x" }))!;
  assert.equal(odd.section, "strategies");
  assert.equal(odd.helpful, 0);
  assert.equal(odd.origin, "brain");
  assert.equal(shapeLesson({ id: "x" }), null);
  assert.equal(shapeLesson({ text: "uden id" }), null);
});

test("gruppering: planens rækkefølge, tomme sektioner udelades, bedste først", () => {
  const a = shapeLesson(row({ id: "a", helpful: 1, harmful: 0 }))!;
  const b = shapeLesson(row({ id: "b", helpful: 5, harmful: 0 }))!;
  const c = shapeLesson(row({ id: "c", section: "strategies" }))!;
  const groups = groupLessons([a, b, c]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["strategies", "red_flags"],
  );
  assert.deepEqual(
    groups[1]!.lessons.map((l) => l.id),
    ["b", "a"],
  );
});

test("scope: kun tekst og tal, højst fire", () => {
  assert.equal(scopeText(null), null);
  assert.equal(scopeText([]), null);
  assert.equal(scopeText({ a: { b: 1 } }), null);
  assert.equal(scopeText({ a: 1, b: "x", c: 3, d: 4, e: 5 }), "a: 1 · b: x · c: 3 · d: 4");
});

test("indsigt: lektionen bag et forslag findes via refs", () => {
  assert.equal(
    insightBulletId([
      { kind: "decision", id: "d" },
      { kind: "bullet", id: "b1" },
    ]),
    "b1",
  );
  assert.equal(insightBulletId(null), null);
  assert.equal(insightBulletId([{ kind: "bullet" }]), null);
  const lessons = new Map([["b1", shapeLesson(row())!]]);
  const insight = shapeInsight(
    {
      id: "i1",
      kind: "lesson_candidate",
      title: "Ny lektion",
      body_md: "x",
      priority: 9,
      refs: [{ kind: "bullet", id: "b1" }],
    },
    lessons,
  )!;
  assert.equal(insight.lesson?.shortId, "pb-00001");
  assert.equal(insight.priority, 3);
  const other = shapeInsight({ id: "i2", kind: "pattern", title: "", refs: [] }, lessons)!;
  assert.equal(other.lesson, null);
  assert.equal(other.title, "Indsigt");
  assert.equal(shapeInsight({ kind: "pattern" }, lessons), null);
});

test("refleksion: kræver enighed eller en indsigt", () => {
  const ok = shapeReflection({
    object_id: "d1",
    created_at: "t",
    after: { decision: "reject", agreement: "Enig", keyInsight: "  For tidligt  " },
  })!;
  assert.equal(ok.keyInsight, "For tidligt");
  assert.equal(ok.decision, "reject");
  assert.equal(shapeReflection({ object_id: "d1", after: {} }), null);
  assert.equal(shapeReflection({ object_id: "d1", after: null }), null);
  assert.equal(shapeReflection({ after: { keyInsight: "x" } }), null);
});

test("hændelse, tekstkontrol og bjælke", () => {
  assert.equal(
    shapeEvent({ source_kind: "corroborate", reason: "r", delta_helpful: 1 })!.kind,
    "Bekræftet af en anden beslutning",
  );
  assert.equal(shapeEvent({ reason: "r" }), null);
  // A user's action is named by its reason (0081: "Godkendt af en bruger", "Pensioneret ..."):
  assert.equal(
    shapeEvent({ source_kind: "user", reason: "Godkendt af en bruger" })!.kind,
    "Godkendt af en bruger",
  );
  assert.equal(shapeEvent({ source_kind: "user", reason: "" })!.kind, "Ændret af en bruger");
  assert.equal(checkLessonText("  ").ok, false);
  assert.equal(checkLessonText("x".repeat(501)).ok, false);
  assert.deepEqual(checkLessonText(" en  lektion\n"), { ok: true, text: "en lektion" });
  assert.equal(helpfulShare(3, 1), 75);
  assert.equal(helpfulShare(0, 0), null);
});

test("scope: reflektorens lister vises med danske navne", () => {
  assert.equal(
    scopeText({ sectors: ["fintech", "saas"], stages: ["seed"], geographies: [] }),
    "Sektor: fintech, saas · Fase: seed",
  );
  assert.equal(scopeText({ sectors: [1, null] }), null);
});

test("hvorfor: kilderne opsummeres i hele sætninger", () => {
  assert.equal(evidenceSummary([]), null);
  assert.equal(evidenceSummary([{ kind: "decision" }]), "Bygger på 1 beslutning");
  assert.equal(
    evidenceSummary([{ kind: "decision" }, { kind: "decision" }, { kind: "episode" }]),
    "Bygger på 2 beslutninger og 1 kilde",
  );
  assert.equal(
    evidenceSummary([{ kind: "fact" }, { kind: "x" }, { kind: "y" }, { kind: "episode" }]),
    "Bygger på 1 fakta, 2 andre kilder og 1 kilde",
  );
  assert.equal(AGREEMENT_LABEL["team_stricter"], "I var strengere end analysen");
});

test("dato: dag, kort måned og år; ugyldigt giver tom tekst", () => {
  assert.equal(lessonDate("2026-10-07T18:02:11.123Z"), "7. okt 2026");
  assert.equal(lessonDate("i går"), "");
  assert.equal(lessonDate("2026-13-01"), "");
});

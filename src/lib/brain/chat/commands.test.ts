/** Brain's chat commands. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  BRAIN_COMMANDS,
  commandAnswerPrefix,
  commandProblem,
  commandPromptSection,
  commandQuestion,
  parseCommand,
} from "./commands.ts";

test("a message starting with a command is parsed, in any case, with its text", () => {
  const parsed = parseCommand("  /Forbered-møde  med fokus på kunderne");
  assert.equal(parsed?.command.id, "prepare_meeting");
  assert.equal(parsed?.rest, "med fokus på kunderne");
  assert.equal(parseCommand("/sammenlign")?.command.id, "compare");
  assert.equal(parseCommand("/hvorfor")?.rest, "");
  assert.equal(parseCommand("/forbered-moede")?.command.id, "prepare_meeting");
});

test("a slash inside a message, or an unknown command, is not a command", () => {
  assert.equal(parseCommand("Hvad er forskellen på A/B og /hvorfor?"), null);
  assert.equal(parseCommand("/hvorforpaadenne"), null);
  assert.equal(parseCommand("/ukendt noget"), null);
  assert.equal(parseCommand("Hvad er ARR?"), null);
});

test("each command needs its subjects, counting the case and the @-chosen entities", () => {
  const compare = BRAIN_COMMANDS.find((c) => c.id === "compare")!;
  assert.match(commandProblem(compare, { hasCase: false, entityCount: 0 }) ?? "", /mangler 2/);
  assert.match(commandProblem(compare, { hasCase: true, entityCount: 0 }) ?? "", /mangler en case/);
  assert.equal(commandProblem(compare, { hasCase: true, entityCount: 1 }), null);
  assert.equal(commandProblem(compare, { hasCase: false, entityCount: 2 }), null);
  const why = BRAIN_COMMANDS.find((c) => c.id === "why")!;
  assert.equal(commandProblem(why, { hasCase: true, entityCount: 0 }), null);
});

test("the prompt section is the instruction; a command that cannot run gets the usage hint", () => {
  const parsed = parseCommand("/hvorfor")!;
  const ok = commandPromptSection(parsed);
  assert.match(ok, /explain why the case ended/);
  assert.match(ok, /Prefer these tools: get_case/);
  assert.match(
    commandProblem(parsed.command, { hasCase: false, entityCount: 0 }) ?? "",
    /Brug: \/hvorfor/,
  );
});

test("the model reads the text after the command, or a default", () => {
  assert.equal(commandQuestion(parseCommand("/hvorfor fravalgt")!), "fravalgt");
  assert.equal(commandQuestion(parseCommand("/sammenlign")!), "Kør /sammenlign.");
});

test("the two commands of T-120 parse, and each has its own subjects", () => {
  assert.equal(parseCommand("/tidslinje")?.command.id, "timeline");
  assert.equal(parseCommand("/Djævlens-Advokat")?.command.id, "devils_advocate");
  assert.equal(parseCommand("/djaevlens-advokat?")?.command.id, "devils_advocate");
  const devil = BRAIN_COMMANDS.find((c) => c.id === "devils_advocate")!;
  assert.match(commandProblem(devil, { hasCase: false, entityCount: 0 }) ?? "", /Brug: \/djævlens/);
  assert.equal(commandProblem(devil, { hasCase: true, entityCount: 0 }), null);
  assert.equal(
    commandAnswerPrefix(devil, "da"),
    "Dette er et bevidst ensidigt argument og ikke Brains vurdering.",
  );
  assert.equal(
    commandAnswerPrefix(devil, "en"),
    "This is a deliberately one-sided argument and not Brain's assessment.",
  );
  assert.equal(commandAnswerPrefix(BRAIN_COMMANDS[0]!, "da"), null);
  assert.match(devil.instruction, /do not repeat it/);
  const timeline = BRAIN_COMMANDS.find((c) => c.id === "timeline")!;
  assert.match(timeline.instruction, /also call case_brief/);
  assert.match(devil.instruction, /Never recommend a decision/);
});

test("no command asks for a decision", () => {
  for (const command of BRAIN_COMMANDS) {
    assert.match(command.instruction, /Never (recommend|say which|add reasons|add events)/);
  }
});

test("punctuation after a command does not hide it, and decomposed letters are composed", () => {
  assert.equal(parseCommand("/hvorfor?")?.command.id, "why");
  assert.equal(parseCommand("/sammenlign: A og B")?.rest, "A og B");
  assert.equal(parseCommand("/FORBERED-MØDE")?.command.id, "prepare_meeting");
});

test("every tool a command points to is defined in the chat's tools", () => {
  const source = readFileSync(new URL("./tools.server.ts", import.meta.url), "utf8");
  for (const command of BRAIN_COMMANDS) {
    for (const name of command.tools) {
      assert.match(source, new RegExp(`\\b${name}: tool\\(`), `${command.id}: ${name}`);
    }
  }
});

test("a command without subjects and its default question follow the team's language (T-747 b)", () => {
  const compare = BRAIN_COMMANDS.find((c) => c.id === "compare")!;
  const en = commandProblem(compare, { hasCase: true, entityCount: 0 }, "en") ?? "";
  assert.equal(
    en,
    "/sammenlign needs a case or a company. Use: /sammenlign and choose two companies or cases with @.",
  );
  assert.doesNotMatch(en, /mangler|Brug/);
  assert.equal(commandQuestion(parseCommand("/sammenlign")!, "en"), "Run /sammenlign.");
  assert.equal(commandQuestion(parseCommand("/sammenlign")!, "da"), "Kør /sammenlign.");
});

test("source labels are saved in the team's language (T-747 c)", async () => {
  const { episodeLabel } = await import("./sources.ts");
  assert.equal(episodeLabel("answer", "en"), "Saved answer");
  assert.equal(episodeLabel("answer", "da"), "Gemt svar");
  assert.equal(episodeLabel("evidence", "en"), "Evidence");
  assert.equal(episodeLabel("no_such_kind", "en"), "Source");
  assert.equal(episodeLabel(null, "da"), "Kilde");
});

test("Brain's tools never hand the model a raw reason code or a Danish word in an English team (T-747 c, e; T-750 b)", async () => {
  const { readFileSync } = await import("node:fs");
  const tools = readFileSync(new URL("./tools.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(tools, /labels\.get\(code\) \?\? code\b/);
  assert.match(tools, /brainServer\.chat\.reason\.\$\{code\}/);
  assert.doesNotMatch(tools, /"Nettet"|"Kilde"|"Casen"|`Årsager:/);
  // The serious kinds are read apart, newest first.
  assert.match(tools, /read\(BRIEF_SERIOUS_KINDS, 300\)/);
  assert.match(tools, /\.order\("recorded_at", \{ ascending: false \}\)/);
});

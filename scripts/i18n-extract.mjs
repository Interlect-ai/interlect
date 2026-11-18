#!/usr/bin/env node
/**
 * Finds the interface texts that are not in the dictionaries yet: JSX text, text in
 * user-facing JSX attributes (title, placeholder, aria-label, alt, label …) and string literals
 * that read as Danish, in src/components, src/routes and src/lib (prompts, eval and demo data
 * are skipped; server functions only with --server).
 * Moves them into src/lib/i18n/dictionaries page by page; this lists what is left.
 *
 *   npm run i18n:extract                       # summary per file, biggest first
 *   npm run i18n:extract -- src/components/brain   # only under that path
 *   npm run i18n:extract -- --json out.json    # every text with file, line and kind
 *   npm run i18n:extract -- --max 0            # fail when any text is left (for CI later)
 *   npm run i18n:extract -- --server           # also server functions' messages to the user
 *
 * Texts that stay Danish on purpose are not counted: whole files or folders listed with a reason
 * in scripts/i18n-keep.json (prompts, templates saved in the setup, internal pages), and a
 * declaration or statement with a comment containing "i18n-keep" right above it. Names that read
 * the same in both languages (Interlect, Brain, CVR) and locale tags ("en-CA") are not texts.
 *
 * Reads the files with the TypeScript parser (no regex over code). Never changes a file and
 * sends nothing anywhere.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const DEFAULT_PATHS = ["src/components", "src/routes", "src/lib"];
const SKIP_DIRS = new Set(["node_modules", "i18n", "demo", "eval", "prompts"]);
const SKIP_ALWAYS = /(\.test\.|routeTree\.gen|\.d\.ts$)/;
const SKIP_SERVER = /(\.server\.|\.functions\.)/;
const TEXT_ATTRIBUTES = new Set([
  "title",
  "placeholder",
  "aria-label",
  "aria-description",
  "alt",
  "label",
  "description",
  "helperText",
  "emptyText",
  "tooltip",
]);
const KEEP = JSON.parse(readFileSync(join(ROOT, "scripts/i18n-keep.json"), "utf8"));
const KEEP_PATHS = Object.keys(KEEP).filter((key) => !key.startsWith("//"));
/** Words that are the same in Danish and English (names, abbreviations). */
const NEUTRAL = new Set(["Interlect", "Interlect.ai", ".ai", "Brain", "CVR", "PDF", "https://"]);
const CALLS_TO_SKIP = new Set(["console", "assert", "require", "import", "t", "translate"]);
// Danish letters, or a common Danish word on its own (English shares few of these).
const DANISH =
  /[æøåÆØÅ]|\b(og|ikke|der|det|som|til|med|på|af|en|et|er|kan|skal|har|ingen|alle|eller|fra|når|hvis|jeres|vores|fonden|casen|kør|opret|gem|vælg|luk|tilføj|slet|ret|vis|skjul|hent|prøv|igen)\b/i;

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args.splice(index, 2)[1] ?? null);
};
const jsonOut = option("--json");
const serverIndex = args.indexOf("--server");
const withServer = serverIndex !== -1;
if (withServer) args.splice(serverIndex, 1);
const max = option("--max");
const paths = args.length ? args : DEFAULT_PATHS;

function* files(path) {
  const full = join(ROOT, path);
  const stat = statSync(full, { throwIfNoEntry: false });
  if (!stat) return;
  if (keptOnPurpose(path)) return;
  if (stat.isFile()) {
    if (!/\.(tsx?|jsx?)$/.test(path) || SKIP_ALWAYS.test(path)) return;
    if (!withServer && SKIP_SERVER.test(path)) return;
    yield full;
    return;
  }
  for (const entry of readdirSync(full)) {
    if (SKIP_DIRS.has(entry)) continue;
    yield* files(join(path, entry));
  }
}

/** Whether scripts/i18n-keep.json lists the file or a folder (or file prefix) it is in. */
function keptOnPurpose(path) {
  const normalized = path.split(sep).join("/");
  return KEEP_PATHS.some((kept) => normalized.startsWith(kept));
}

/** Only names, abbreviations or a locale tag: the same text in both languages. */
function isNeutral(text) {
  const value = text.trim();
  if (NEUTRAL.has(value) || /^[a-z]{2}-[A-Z]{2}$/.test(value)) return true;
  const words = value.split(/[\s·:,()]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => NEUTRAL.has(word));
}

/** A comment with "i18n-keep" right above the text's declaration or statement (or the text). */
function keptByComment(node, source) {
  for (let current = node; current && !ts.isSourceFile(current); current = current.parent) {
    const leading = source.text.slice(current.getFullStart(), current.getStart(source));
    if (leading.includes("i18n-keep")) return true;
  }
  return false;
}

/** Whether a string is something a person reads (not a class list, path, key or token). */
function isProse(text) {
  const value = text.trim();
  if (value.length < 2 || !/\p{L}/u.test(value)) return false;
  if (/^[a-z0-9_.:/#@?=&%-]+$/.test(value)) return false; // keys, paths, urls, enums
  if (/^(?:[a-z0-9:[\]()/.!%_-]+\s+)*[a-z0-9:[\]()/.!%_-]+$/.test(value) && value.includes("-"))
    return false; // class lists ("flex items-center gap-2")
  return DANISH.test(value);
}

function calleeName(node) {
  let expression = node.expression;
  while (ts.isPropertyAccessExpression(expression)) expression = expression.expression;
  return ts.isIdentifier(expression) ? expression.text : null;
}

function insideSkippedCall(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent)) {
      const name = calleeName(parent);
      if (name && CALLS_TO_SKIP.has(name)) return true;
    }
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  }
  return false;
}

function attributeName(node) {
  const parent = node.parent;
  if (ts.isJsxAttribute(parent)) return parent.name.getText();
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent))
    return parent.parent.name.getText();
  return null;
}

function scan(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  const add = (node, text, kind) => {
    if (isNeutral(text) || keptByComment(node, source)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    found.push({ file: relative(ROOT, file), line: line + 1, kind, text: text.trim() });
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/g, " ");
      if (/\p{L}/u.test(text) && text.trim().length > 1) add(node, text, "jsx-text");
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const attribute = attributeName(node);
      if (attribute === "className" || attribute === "key" || attribute === "href") {
        // never prose
      } else if (attribute && TEXT_ATTRIBUTES.has(attribute) && /\p{L}/u.test(node.text)) {
        add(node, node.text, "attribute");
      } else if (!insideSkippedCall(node) && isProse(node.text)) {
        add(node, node.text, "string");
      }
    } else if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(
        "{…}",
      );
      if (!insideSkippedCall(node) && isProse(text)) add(node, text, "template");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const all = [];
for (const path of paths) for (const file of files(path)) all.push(...scan(file));

const perFile = new Map();
for (const entry of all) perFile.set(entry.file, (perFile.get(entry.file) ?? 0) + 1);
const rows = [...perFile.entries()].sort((a, b) => b[1] - a[1]);
for (const [file, count] of rows) console.log(`${String(count).padStart(5)}  ${file}`);
console.log(`\n${all.length} tekster i ${rows.length} filer mangler i ordbøgerne.`);
if (jsonOut) {
  writeFileSync(jsonOut, `${JSON.stringify(all, null, 2)}\n`);
  console.log(`Skrevet: ${jsonOut}`);
}
if (max !== null && all.length > Number(max)) {
  console.error(`Flere end ${max} tekster står uden for ordbøgerne.`);
  process.exit(1);
}

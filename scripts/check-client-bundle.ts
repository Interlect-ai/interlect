/**
 * The browser's files hold no recipe ("ligeså snart nogen får adgang, kan de så … bare kopiere hele
 * strukturen"). Everything a browser can download from a production build
 * (the client assets) must have no source maps and none of the prompt texts that steer the AI:
 * those live in server-only files and reach only the server (prompts) or, for the specialists'
 * instructions, Admin and Lead through `loadStandardModuleText`.
 *
 *   npm run build && node scripts/check-client-bundle.ts [--output .output]
 *
 * Scans `<output>/public` (Nitro's default) or `<output>/static` (the Vercel preset). Exits 1 with
 * the file and the text found. No network, no secrets.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import ts from "typescript";

/** The files whose long strings are prompt text. A new prompt file belongs here. */
const PROMPT_FILES = [
  "src/lib/analysis/specialist-prompts.ts",
  "src/lib/analysis/prompt.ts",
  "src/lib/brain/chat/prompt.ts",
  "src/lib/brain/prompts",
];
/** Only strings this long count, so short labels shared with the screens are not flagged. */
const MIN_LENGTH = 40;

const root = resolve(import.meta.dirname, "..");

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

/**
 * The fixed part of every long string literal in a prompt file: plain strings, templates without
 * substitutions and each template's text up to its first `${`. Read with TypeScript's own parser,
 * so nested templates and escaped quotes are handled as the compiler does.
 */
export function promptNeedles(source: string): string[] {
  const needles = new Set<string>();
  const file = ts.createSourceFile("prompt.ts", source, ts.ScriptTarget.Latest, false);
  const add = (text: string) => {
    // The longest line of the literal, so a minifier that writes "\n" differently cannot hide it.
    const line = text.split("\n").reduce((a, b) => (b.trim().length > a.length ? b.trim() : a), "");
    if (line.length >= MIN_LENGTH) needles.add(line.slice(0, 60));
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isTemplateExpression(node)) {
      add(node.head.text);
      for (const span of node.templateSpans) add(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...needles];
}

function main() {
  const { values } = parseArgs({ options: { output: { type: "string", default: ".output" } } });
  const output = resolve(root, values.output);
  const client = [join(output, "public"), join(output, "static")].find(existsSync);
  if (!client) {
    console.error(`No client assets under ${output} (public/ or static/). Build first.`);
    process.exit(1);
  }
  const assets = files(client).filter((file) => /\.(m?js|css|html|json|map)$/.test(file));
  const needles = PROMPT_FILES.flatMap((path) => files(join(root, path)))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .flatMap((file) =>
      promptNeedles(readFileSync(file, "utf8")).map((text) => ({
        file: relative(root, file),
        text,
      })),
    );
  const problems: string[] = [];
  for (const asset of assets) {
    const name = relative(root, asset);
    if (asset.endsWith(".map")) {
      problems.push(`${name}: a source map`);
      continue;
    }
    const body = readFileSync(asset, "utf8");
    if (/[#@] sourceMappingURL=/.test(body)) problems.push(`${name}: points to a source map`);
    for (const needle of needles)
      if (body.includes(needle.text))
        problems.push(`${name}: prompt text from ${needle.file}: "${needle.text}"`);
  }
  if (problems.length) {
    console.error(`The browser's files hold prompt text or source maps (${problems.length}):`);
    for (const line of problems.slice(0, 40)) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(
    `Client assets clean: ${assets.length} files, ${needles.length} prompt texts checked, no source maps.`,
  );
}

if (import.meta.main) main();

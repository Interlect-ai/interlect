#!/usr/bin/env node
/**
 * Runs after `vite build` (npm run build). Nitro's Vercel preset creates extra functions, such
 * as the queue consumer (/_vercel/queues/consumer, both the deep-analysis and the Brain queue),
 * by copying the server function with fs.cp. fs.cp rewrites relative symlinks to absolute paths
 * on the build machine, so a traced package (today tslib, via @supabase/functions-js) points to
 * /vercel/path0/... inside the copy. That path does not exist when the function runs, and the
 * consumer crashed with ERR_MODULE_NOT_FOUND before it could take a single message.
 *
 * This script points every such link at the same file inside its own function and makes it
 * relative again, then checks every link: it must resolve, and inside its own function (Nitro's
 * whole-function aliases, "x.func -> ./__server.func", inside the functions folder). Anything
 * else fails the build. Without .vercel/output (a local build with the node preset) there is
 * nothing to do; on Vercel (or in CI, which builds with NITRO_PRESET=vercel) that means Nitro's
 * output moved, which also fails the build.
 */
import { existsSync } from "node:fs";
import { lstat, readdir, readlink, realpath, symlink, unlink } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".vercel/output/functions");

/** The nearest ancestor directory whose name ends in .func. */
function functionDir(file) {
  let dir = path.dirname(file);
  while (dir.startsWith(root) && dir !== root) {
    if (dir.endsWith(".func")) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

async function* symlinks(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) yield full;
    else if (entry.isDirectory()) yield* symlinks(full);
  }
}

async function main() {
  if (!existsSync(root)) {
    // A Vercel build, or CI building with the Vercel preset (checks.yml), must have the output.
    if (process.env["VERCEL"] || process.env["NITRO_PRESET"] === "vercel") {
      console.error(
        `[vercel-symlinks] ${root} is missing on a Vercel build: Nitro's output moved.`,
      );
      process.exit(1);
    }
    return;
  }
  let repaired = 0;
  const broken = [];
  for await (const link of symlinks(root)) {
    const target = await readlink(link);
    if (!path.isAbsolute(target)) continue;
    const ownFunction = functionDir(link);
    const targetFunction = functionDir(target);
    if (!ownFunction || !targetFunction) {
      broken.push(`${path.relative(root, link)} -> ${target}`);
      continue;
    }
    const local = path.join(ownFunction, path.relative(targetFunction, target));
    if (!existsSync(local)) {
      broken.push(`${path.relative(root, link)} -> ${target} (no copy in its own function)`);
      continue;
    }
    // Only Windows distinguishes directory and file links; Vercel builds on Linux.
    const type = (await lstat(local)).isDirectory() ? "dir" : "file";
    await unlink(link);
    await symlink(path.relative(path.dirname(link), local), link, type);
    repaired += 1;
  }

  // Every link, repaired or not, must resolve inside the function that ships it.
  let checked = 0;
  for await (const link of symlinks(root)) {
    checked += 1;
    const boundaryDir = functionDir(link) ?? (link.endsWith(".func") ? root : null);
    let resolved = null;
    let boundary = null;
    try {
      // Both sides through realpath, so a symlinked parent folder cannot fake an escape.
      resolved = await realpath(link);
      boundary = boundaryDir && (await realpath(boundaryDir));
    } catch {
      // dangling: reported below
    }
    const inside =
      boundary !== null &&
      resolved !== null &&
      (resolved === boundary || resolved.startsWith(boundary + path.sep));
    if (!inside) {
      broken.push(
        `${path.relative(root, link)} -> ${await readlink(link)} (dangles or leaves its function)`,
      );
    }
  }

  if (broken.length > 0) {
    console.error("[vercel-symlinks] links that will not resolve when the function runs:");
    for (const line of broken) console.error(`  ${line}`);
    process.exit(1);
  }
  console.info(`[vercel-symlinks] checked ${checked} link(s), made ${repaired} relative.`);
}

await main();

import { createHash } from "node:crypto";

/** Same as demoId in scripts/brain-seed-demo.ts: a stable uuid from a name. */
export function demoId(name: string): string {
  const h = createHash("sha1").update(`interlect-demo:${name}`).digest("hex");
  const variant = ((parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

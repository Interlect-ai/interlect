/** A PowerPoint file is never unpacked beyond its slide text. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { extractPptxSlides } from "./file-text.server.ts";

const slide = (text: string) =>
  strToU8(`<p:sld xmlns:a="a" xmlns:p="p"><a:t>${text}</a:t></p:sld>`);

test("pptx: the slide text is read and other entries are never inflated", async () => {
  const bytes = zipSync({
    "ppt/slides/slide1.xml": slide("Hello"),
    "ppt/slides/slide2.xml": slide("World"),
    "ppt/media/huge.bin": new Uint8Array(30 * 1024 * 1024),
  });
  const result = await extractPptxSlides(bytes);
  assert.equal(result.totalPages, 2);
  assert.deepEqual(
    result.pages.map((page) => page.text),
    ["Hello", "World"],
  );
});

test("pptx: a slide that unpacks to far more than text is refused", async () => {
  const bytes = zipSync({ "ppt/slides/slide1.xml": new Uint8Array(6 * 1024 * 1024) });
  await assert.rejects(() => extractPptxSlides(bytes), /too large|for stor/);
});

test("pptx: many slides together may not unpack past the total ceiling", async () => {
  const files: Record<string, Uint8Array> = {};
  for (let i = 1; i <= 10; i += 1)
    files[`ppt/slides/slide${i}.xml`] = new Uint8Array(4.5 * 1024 * 1024);
  await assert.rejects(() => extractPptxSlides(zipSync(files)), /too large|for stor/);
});

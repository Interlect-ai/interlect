/**
 * Draws Brain's answer text. The text is parsed by `parseModelText` (chat-text.ts) and
 * drawn ONLY as React text nodes: no HTML, no images, no external links. Citation markers [n]
 * appear only for numbers the answer really has a source for. While streaming, the coral caret
 * follows the last character.
 */
import { Fragment, useMemo, type ReactNode } from "react";
import { StreamCaret } from "@/components/ds/ChatThread";
import { parseModelText, type Block, type Inline } from "@/lib/brain/chat-text";

function InlineView({
  items,
  displayNumbers,
}: {
  items: readonly Inline[];
  displayNumbers?: ReadonlyMap<number, number> | undefined;
}) {
  return (
    <>
      {items.map((item, index) => {
        switch (item.t) {
          case "text":
            return <Fragment key={index}>{item.text}</Fragment>;
          case "bold":
            return (
              <strong key={index} className="font-semibold">
                {item.text}
              </strong>
            );
          case "cite": {
            const shown = displayNumbers?.get(item.n) ?? item.n;
            return (
              <span
                key={index}
                role="note"
                aria-label={`Kilde ${shown}`}
                className="mx-0.5 inline-grid h-[18px] min-w-[18px] translate-y-[-1px] place-items-center rounded-[6px] bg-ai-wash px-1 align-baseline text-[11px] leading-none font-medium text-ai-ink"
              >
                {shown}
              </span>
            );
          }
          case "link":
            return (
              <a key={index} href={item.href} className="text-ink-1 underline underline-offset-2">
                {item.text}
              </a>
            );
        }
      })}
    </>
  );
}

function BlockView({
  block,
  trailing,
  displayNumbers,
}: {
  block: Block;
  trailing?: ReactNode;
  displayNumbers?: ReadonlyMap<number, number> | undefined;
}) {
  if (block.t === "p") {
    return (
      <p className="m-0 text-[16px] leading-[1.7] break-words whitespace-pre-line text-pretty text-ink-1">
        <InlineView items={block.inline} displayNumbers={displayNumbers} />
        {trailing}
      </p>
    );
  }
  const List = block.t === "ol" ? "ol" : "ul";
  return (
    <List
      className={`m-0 flex flex-col gap-1.5 pl-5 text-[16px] leading-[1.7] text-ink-1 ${
        block.t === "ol" ? "list-decimal" : "list-disc"
      }`}
    >
      {block.items.map((item, index) => (
        <li key={index} className="pl-1 break-words text-pretty">
          <InlineView items={item} displayNumbers={displayNumbers} />
          {index === block.items.length - 1 && trailing}
        </li>
      ))}
    </List>
  );
}

export function SafeText({
  text,
  streaming = false,
  citationNumbers,
  displayNumbers,
}: {
  text: string;
  streaming?: boolean;
  /** The source numbers the answer has; any other [n] is dropped. */
  citationNumbers: ReadonlySet<number>;
  /** Stored source number → the number shown (order of first appearance); default: as stored. */
  displayNumbers?: ReadonlyMap<number, number>;
}) {
  const blocks = useMemo(
    () => parseModelText(text, citationNumbers, { streaming }),
    [text, citationNumbers, streaming],
  );
  const caret = streaming ? <StreamCaret /> : null;
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          displayNumbers={displayNumbers}
          trailing={index === blocks.length - 1 ? caret : null}
        />
      ))}
      {streaming && blocks.length === 0 && (
        <p className="m-0 text-[16px] leading-[1.7]" aria-hidden>
          {caret}
        </p>
      )}
    </>
  );
}

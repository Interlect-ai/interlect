/**
 * Page limits per source. No imports, so the Kilder page can use them without pulling in
 * the parsers.
 */
export const MAX_PDF_PAGES = 300;
export const MAX_SITE_PAGES = 40;

/** The most pages a source can be read up to ("læs kun de første N sider"). */
export function maxPagesOf(kind: string): number {
  return kind === "website" ? MAX_SITE_PAGES : MAX_PDF_PAGES;
}

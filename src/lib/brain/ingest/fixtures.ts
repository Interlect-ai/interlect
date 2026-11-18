/** Small real files for the ingest tests (built in memory, nothing is read from disk). */
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strToU8, zipSync } from "fflate";

/** A PDF with one text block per page (and an optional header/footer repeated on every page). */
export async function pdfFixture(
  pages: string[][],
  options: { header?: string; footer?: string } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    if (options.header) page.drawText(options.header, { x: 40, y: 820, size: 9, font });
    for (const line of lines) {
      page.drawText(line, { x: 40, y, size: 11, font });
      y -= 18;
    }
    if (options.footer) page.drawText(options.footer, { x: 40, y: 20, size: 9, font });
  }
  return doc.save();
}

/** A minimal Word document: paragraphs, headings (Heading1/2) and one table. */
export function docxFixture(
  body: Array<{ p: string } | { h1: string } | { h2: string } | { table: string[][] }>,
): Uint8Array {
  const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const xml = body
    .map((item) => {
      if ("p" in item) return `<w:p><w:r><w:t>${esc(item.p)}</w:t></w:r></w:p>`;
      if ("h1" in item) {
        return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(item.h1)}</w:t></w:r></w:p>`;
      }
      if ("h2" in item) {
        return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${esc(item.h2)}</w:t></w:r></w:p>`;
      }
      const rows = item.table
        .map(
          (row) =>
            `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${esc(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`,
        )
        .join("");
      return `<w:tbl>${rows}</w:tbl>`;
    })
    .join("");
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "word/styles.xml": strToU8(styles),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xml}</w:body></w:document>`,
    ),
  });
}

/** An Excel workbook with the given sheets (first row of each is the header). */
export async function xlsxFixture(
  sheets: Record<string, Array<Array<string | number | null>>>,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

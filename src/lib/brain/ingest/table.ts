/** The raw table of a CSV or Excel file (first visible sheet), for the history guide. */
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { BrainUserError } from "../errors.ts";
import { decodeText } from "./extract.ts";
import { MAX_TABLE_ROWS } from "./file-kind.ts";
import { serverText } from "../../i18n/server-text.ts";

export interface RawTable {
  headers: string[];
  rows: string[][];
  sheet: string | null;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined)
      return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    return "";
  }
  return String(value).trim();
}

export async function readRawTable(bytes: Uint8Array, kind: "csv" | "xlsx"): Promise<RawTable> {
  let table: string[][];
  let sheetName: string | null = null;
  if (kind === "csv") {
    const parsed = Papa.parse<string[]>(decodeText(bytes), {
      header: false,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
    });
    if (parsed.errors.some((error) => error.type === "Quotes")) {
      throw new BrainUserError(serverText("brainServer.extract.csvQuoteShort"));
    }
    table = parsed.data
      .filter((row) => Array.isArray(row))
      .map((row) => row.map((c) => String(c ?? "").trim()));
  } else {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    } catch {
      throw new BrainUserError(serverText("brainServer.extract.excel"));
    }
    const sheet = workbook.worksheets.find((s) => !s.state || s.state === "visible");
    if (!sheet) throw new BrainUserError(serverText("brainServer.extract.excelNoSheet"));
    sheetName = sheet.name;
    table = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cells[column - 1] = cellText(cell.value);
      });
      for (let i = 0; i < cells.length; i += 1) cells[i] ??= "";
      if (cells.some((c) => c)) table.push(cells);
    });
  }
  if (table.length < 2) throw new BrainUserError(serverText("brainServer.extract.noRows"));
  const width = Math.max(...table.map((row) => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? "");
  const headers = pad(table[0]!).map(
    (h, i) => h || serverText("brainServer.history.column", { n: i + 1 }),
  );
  const rows = table.slice(1).map(pad);
  if (rows.length > MAX_TABLE_ROWS)
    throw new BrainUserError(
      serverText("brainServer.extract.tooManyRowsShort", {
        rows: rows.length,
        max: MAX_TABLE_ROWS,
      }),
    );
  return { headers, rows, sheet: sheetName };
}

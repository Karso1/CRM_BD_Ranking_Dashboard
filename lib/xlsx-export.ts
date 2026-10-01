import { zipSync } from "fflate";

export type WorkbookCell = string | number | null | undefined;
export type WorkbookSheet = { name: string; headers: string[]; rows: WorkbookCell[][] };

const encoder = new TextEncoder();
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const column = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : `${column(Math.floor(index / 26) - 1)}${column(index % 26)}`;

function sheetXml(sheet: WorkbookSheet): string {
 const allRows = [sheet.headers, ...sheet.rows];
 const rows = allRows.map((values, rowIndex) => {
  const cells = values.map((value, colIndex) => {
   if (value === null || value === undefined || value === "") return "";
   const ref = `${column(colIndex)}${rowIndex + 1}`;
   if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${rowIndex === 0 ? 1 : 0}"><v>${value}</v></c>`;
   return `<c r="${ref}" s="${rowIndex === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
  }).join("");
  return `<row r="${rowIndex + 1}">${cells}</row>`;
 }).join("");
 const last = `${column(Math.max(sheet.headers.length - 1, 0))}${Math.max(allRows.length, 1)}`;
 const widths = sheet.headers.map((header, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(Math.max(header.length * 2, 16), 32)}" customWidth="1"/>`).join("");
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}

export function createWorkbook(sheets: WorkbookSheet[]): Uint8Array {
 if (!sheets.length) throw new Error("An Excel workbook needs at least one sheet");
 const files: Record<string, Uint8Array> = {};
 const add = (path: string, content: string) => { files[path] = encoder.encode(content); };
 add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
 add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
 add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
 add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
 add("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173B35"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
 sheets.forEach((sheet, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)));
 return zipSync(files, { level: 6 });
}

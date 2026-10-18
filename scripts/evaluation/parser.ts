/** Strict parser for CiteULike-a only. CiteULike-t has a different tag format. */
export interface DatasetItem {
  id: number;
  title: string;
  abstract?: string;
  tags: string[];
}
export interface ParsedDataset {
  items: DatasetItem[];
  users: number[][];
  diagnostics: {
    filesWithInvalidUtf8: number;
    replacementCharacters: number;
    metadataRows: number;
    itemTagRows: number;
    tagRows: number;
    userRows: number;
    interactions: number;
    rawInteractions: number;
    duplicateInteractionsRemoved: number;
    duplicateTagIdsRemoved: number;
    parseSuccessRate: number;
    missingAbstractRate: number;
    missingTagsRate: number;
    missingDoiRate: number;
    missingPublicationTimeRate: number;
    missingInteractionTimeRate: number;
    missingAuthorRate: number;
  };
}

/** RFC 4180 quotes/newlines, CRLF and BOM, with strict malformed-quote rejection. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/u, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (field || closed) throw new Error("Invalid CSV quote");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closed = false;
    } else {
      if (closed) throw new Error("Unexpected text after CSV closing quote");
      field += char;
    }
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  if (field || row.length || closed) rows.push([...row, field]);
  return rows;
}

function lines(text: string): string[] {
  const rows = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (rows.at(-1) === "") rows.pop();
  return rows;
}
function integer(text: string, context: string): number {
  if (!/^\d+$/u.test(text) || !Number.isSafeInteger(Number(text)))
    throw new Error(`Invalid integer in ${context}`);
  return Number(text);
}
export function parseIndexedRows(
  text: string,
  upperBound: number,
  context: string,
): { rows: number[][]; duplicates: number; rawEntries: number } {
  let duplicates = 0;
  let rawEntries = 0;
  const rows = lines(text).map((line, rowIndex) => {
    const parts = line.trim().split(/\s+/u);
    const count = integer(parts[0], `${context} row ${rowIndex}`);
    if (count !== parts.length - 1)
      throw new Error(`Length prefix mismatch in ${context} row ${rowIndex}`);
    const values = parts.slice(1).map((value) => {
      const id = integer(value, context);
      if (id >= upperBound)
        throw new Error(`Out-of-range index in ${context} row ${rowIndex}`);
      return id;
    });
    const unique = [...new Set(values)].sort((a, b) => a - b);
    duplicates += values.length - unique.length;
    rawEntries += values.length;
    return unique;
  });
  return { rows, duplicates, rawEntries };
}

export function parseDataset(input: {
  metadata: string;
  users: string;
  tags: string;
  itemTags: string;
  encodingDiagnostics?: {
    filesWithInvalidUtf8: number;
    replacementCharacters: number;
  };
}): ParsedDataset {
  const records = parseCsv(input.metadata);
  const header = records.shift();
  const expected = [
    "doc.id",
    "title",
    "citeulike.id",
    "raw.title",
    "raw.abstract",
  ];
  if (JSON.stringify(header) !== JSON.stringify(expected))
    throw new Error("Unexpected CiteULike-a metadata columns");
  if (!records.length) throw new Error("Empty metadata");
  const tags = lines(input.tags).map((tag) => tag.trim());
  const items: DatasetItem[] = new Array(records.length);
  for (const record of records) {
    if (record.length !== expected.length)
      throw new Error("CSV column count mismatch");
    const id = integer(record[0], "raw-data.csv doc.id") - 1;
    if (id < 0 || id >= records.length || items[id])
      throw new Error("CSV IDs must be unique, contiguous and 1-based");
    const title = record[3].trim() || record[1].trim();
    if (!title) throw new Error(`Missing title for item ${id}`);
    const abstract = record[4].trim() || undefined;
    items[id] = { id, title, abstract, tags: [] };
  }
  const itemTags = parseIndexedRows(
    input.itemTags,
    tags.length,
    "item-tag.dat",
  );
  if (itemTags.rows.length !== items.length)
    throw new Error("Metadata and item-tag.dat row counts differ");
  for (const item of items)
    item.tags = [
      ...new Set(itemTags.rows[item.id].map((id) => tags[id]).filter(Boolean)),
    ];
  const users = parseIndexedRows(input.users, items.length, "users.dat");
  if (!users.rows.length) throw new Error("Empty users.dat");
  return {
    items,
    users: users.rows,
    diagnostics: {
      filesWithInvalidUtf8:
        input.encodingDiagnostics?.filesWithInvalidUtf8 ?? 0,
      replacementCharacters:
        input.encodingDiagnostics?.replacementCharacters ?? 0,
      metadataRows: items.length,
      itemTagRows: itemTags.rows.length,
      tagRows: tags.length,
      userRows: users.rows.length,
      interactions: users.rows.reduce((sum, row) => sum + row.length, 0),
      rawInteractions: users.rawEntries,
      duplicateInteractionsRemoved: users.duplicates,
      duplicateTagIdsRemoved: itemTags.duplicates,
      parseSuccessRate: 1,
      missingAbstractRate:
        items.filter((item) => !item.abstract).length / items.length,
      missingTagsRate:
        items.filter((item) => !item.tags.length).length / items.length,
      missingDoiRate: 1,
      missingPublicationTimeRate: 1,
      missingInteractionTimeRate: 1,
      missingAuthorRate: 1,
    },
  };
}

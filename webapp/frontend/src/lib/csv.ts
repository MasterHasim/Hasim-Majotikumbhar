/** Client-side CSV export — the data driving every export list (Leads, Customers, Call History)
 * is already loaded into the page for the table/board view, so there's no reason to round-trip
 * through the backend for this; it's just a different rendering of what's already in memory. */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCsvCell(raw: string): string {
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCsvCell(String(c.value(row) ?? ''))).join(','));
  return [header, ...lines].join('\r\n');
}

/** UTF-8 BOM prefix so Excel (still the most common opener) detects the encoding correctly
 * instead of mangling anything outside plain ASCII, e.g. the ₹ symbol or non-Latin names. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** YYYY-MM-DD, safe for a filename and sortable. */
export function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

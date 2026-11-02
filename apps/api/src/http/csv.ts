const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Una celda CSV segura:
 * - Texto que empieza con = + - @ (o tab/retorno) se antepone con ' para que Excel/Sheets no lo ejecute
 *   como fórmula (inyección de fórmulas: los nombres y notas los escribe una persona).
 * - Se encierra entre comillas si contiene coma, comilla, salto de línea o espacios en los bordes.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV con BOM UTF-8 (para que Excel respete tildes y la ñ) y saltos de línea CRLF. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

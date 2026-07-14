/* ── PDF ingestion — runs entirely in the browser, costs zero tokens ──
 *
 * Extracts per-page text (reading-order joined), counts embedded images,
 * renders page thumbnails for evidence navigation, and produces cleaned
 * text with repeated header/footer noise stripped.
 */

import * as pdfjs from "pdfjs-dist";
import type { PageText } from "@anantam/shared";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export interface ExtractedDocument {
  pageCount: number;
  pages: PageText[];
  imagesPerPage: number[];
  imageCount: number;
  wordCount: number;
  /** Page renders for the viewer + evidence navigation (dataURL JPEG). */
  thumbnails: string[];
  /** Higher-quality renders of selected pages for AI visual assessment. */
  renderPage: (page: number, maxDim: number, quality: number) => Promise<string>;
}

interface TextItemLike {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

/** Join text items into lines using their y positions, preserving reading flow. */
function itemsToText(items: TextItemLike[]): string {
  let out = "";
  let lastY: number | null = null;
  for (const item of items) {
    const str = item.str ?? "";
    if (!str.trim() && !item.hasEOL) continue;
    const y = item.transform ? item.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      out += "\n";
    } else if (out && !out.endsWith("\n") && !out.endsWith(" ")) {
      out += " ";
    }
    out += str;
    if (item.hasEOL) out += "\n";
    if (y !== null) lastY = y;
  }
  return out;
}

/** Collapse whitespace and strip lines repeated on nearly every page (headers/footers). */
function cleanPages(raw: string[]): string[] {
  const lineCounts = new Map<string, number>();
  const pageLines = raw.map((text) =>
    text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
  for (const lines of pageLines) {
    for (const line of new Set(lines)) {
      if (line.length >= 4 && line.length <= 80) {
        lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
      }
    }
  }
  const threshold = Math.max(3, Math.ceil(raw.length * 0.7));
  const boilerplate = new Set(
    [...lineCounts.entries()].filter(([, n]) => n >= threshold).map(([l]) => l),
  );
  return pageLines.map((lines) =>
    lines.filter((l, i) => !(boilerplate.has(l) && i !== 0)).join("\n"),
  );
}

async function countPageImages(page: pdfjs.PDFPageProxy): Promise<number> {
  try {
    const ops = await page.getOperatorList();
    let count = 0;
    for (const fn of ops.fnArray) {
      if (
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject ||
        fn === pdfjs.OPS.paintImageMaskXObject
      ) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function renderToDataUrl(
  page: pdfjs.PDFPageProxy,
  maxDim: number,
  quality: number,
): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxDim / base.width, maxDim / base.height, 3);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", quality);
}

export async function extractPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedDocument> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pageCount = doc.numPages;

  const rawTexts: string[] = [];
  const imagesPerPage: number[] = [];
  const thumbnails: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    rawTexts.push(itemsToText(textContent.items as TextItemLike[]));
    imagesPerPage.push(await countPageImages(page));
    thumbnails.push(await renderToDataUrl(page, 560, 0.72));
    onProgress?.(i, pageCount);
  }

  const cleaned = cleanPages(rawTexts);
  const pages: PageText[] = cleaned.map((text, i) => ({ page: i + 1, text }));
  const wordCount = cleaned.reduce(
    (n, t) => n + t.split(/\s+/).filter(Boolean).length,
    0,
  );

  return {
    pageCount,
    pages,
    imagesPerPage,
    imageCount: imagesPerPage.reduce((a, b) => a + b, 0),
    wordCount,
    thumbnails,
    renderPage: async (pageNum, maxDim, quality) => {
      const page = await doc.getPage(pageNum);
      return renderToDataUrl(page, maxDim, quality);
    },
  };
}

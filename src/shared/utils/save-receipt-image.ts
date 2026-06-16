// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Render a `ReceiptRecord` to a PNG and save it. Uses `navigator.share({ files })`
 * so iOS/Android surface "Save Image" → Photos; falls back to an `<a download>`
 * on browsers without file sharing. Waits for `document.fonts.ready` so the
 * DM Sans / DM Serif Display / JetBrains Mono families are available (each has a
 * serif/monospace fallback if a load times out).
 */

import type { ReceiptRecord } from "@/features/wallet/api/receipts.ts";
import { itemLineTotalCents } from "@/features/wallet/api/receipts.ts";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import { formatHistoryDate, shortHex, splitDisplayName } from "@/shared/utils/format.ts";

const LW = 600;       // logical canvas width (px)
const PAD = 36;       // outer padding
const IW = LW - PAD * 2; // inner content width

const C = {
  bg:      "#fafaf9",
  text:    "#1c1917",
  sub:     "#44403c",
  tertiary:"#a8a29e",
  muted:   "#78716c",
  border:  "#e7e5e4",
  cardBg:  "#f5f5f4",
} as const;

const QR_SIZE      = 200;
const QR_CARD_PAD  = 10;
const QR_CARD_SIZE = QR_SIZE + QR_CARD_PAD * 2; // 220

/**
 * Save the receipt as a PNG image.
 * - Rejects if canvas export fails.
 * - Resolves silently when the user dismisses the share sheet (`AbortError`).
 */
export async function saveReceiptImage(
  record: ReceiptRecord,
  qrSvg: string | null,
): Promise<void> {
  const canvas = await renderToCanvas(record, qrSvg);
  const blob = await canvasToBlob(canvas);

  const filename = `receipt-${record.receipt.saleId.slice(0, 12)}.png`;
  const file = new File([blob], filename, { type: "image/png" });

  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Receipt" });
    } catch (err) {
      // AbortError = user dismissed the share sheet — not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
    return;
  }

  // Fallback: download link (desktop browsers).
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke after a generous delay so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob((b) => {
    if (b != null) resolve(b);
    else reject(new Error("canvas.toBlob returned null"));
  }, "image/png");
  return promise;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("image load failed"));
  img.src = src;
  return promise;
}

async function renderToCanvas(
  record: ReceiptRecord,
  qrSvg: string | null,
): Promise<HTMLCanvasElement> {
  await document.fonts.ready;

  const { receipt } = record;
  const { business } = receipt;
  const { name, venue } = splitDisplayName(business.name || "");
  const { date, time } = formatHistoryDate(receipt.issuedAt);

  const addressLines = ([
    business.addressLine1,
    business.addressLine2,
    business.phone,
  ] as Array<string | undefined>).filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  type MetaRow = [string, string];
  const metaRows: MetaRow[] = [
    ["Sale ID", receipt.saleId],
    ...(receipt.blockNumber != null ? [["Block", `#${receipt.blockNumber}`] as MetaRow] : []),
    ...(receipt.merchantAddress    ? [["Merchant", shortHex(receipt.merchantAddress)] as MetaRow] : []),
  ];

  // Load QR as raster image from SVG.
  let qrImg: HTMLImageElement | null = null;
  if (qrSvg) {
    const svgBlob = new Blob([qrSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      qrImg = await loadImage(url);
    } catch {
      // QR image is optional — omit gracefully.
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Keep in sync with the draw loop below — each section advances `y` by the
  // same amount as this pre-measurement.
  let h = PAD;
  h += 20;                          // RECEIPT eyebrow
  h += 38;                          // name
  if (venue) h += 24;               // venue sub-heading
  h += addressLines.length * 21;    // address lines
  h += 21;                          // date
  h += 14;                          // gap before divider
  h += 20;                          // hairline + gap after
  h += 56;                          // amount
  h += 24;                          // tax note
  h += 8;                           // gap before divider
  h += 20;                          // hairline + gap after
  h += 26;                          // ITEMS eyebrow
  h += receipt.items.length * 44;   // item rows
  h += 12;                          // gap before divider
  h += 20;                          // hairline + gap after
  if (qrImg) {
    h += QR_CARD_SIZE;              // QR card
    h += 18;                        // caption
    h += 12;                        // gap before divider
    h += 20;                        // hairline + gap after
  }
  h += 26;                          // RECEIPT DETAILS eyebrow
  h += metaRows.length * 26;        // meta rows
  h += PAD;                         // bottom padding

  const DPR = Math.min(window.devicePixelRatio || 1, 3);
  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(LW * DPR);
  canvas.height = Math.round(h  * DPR);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(DPR, DPR);

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, LW, h);

  const left = PAD;
  let y = PAD;

  const hairline = (yy: number) => {
    ctx.save();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, yy + 0.5);
    ctx.lineTo(left + IW, yy + 0.5);
    ctx.stroke();
    ctx.restore();
  };

  const eyebrow = (text: string, ex: number, ey: number) => {
    ctx.save();
    ctx.font = "600 10px 'DM Sans', sans-serif";
    ctx.letterSpacing = "1.5px";
    ctx.fillStyle = C.muted;
    ctx.fillText(text, ex, ey);
    ctx.restore();
  };

  const rrect = (rx: number, ry: number, rw: number, rh: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(rx + r, ry);
    ctx.lineTo(rx + rw - r, ry);
    ctx.arcTo(rx + rw, ry,      rx + rw, ry + r,      r);
    ctx.lineTo(rx + rw, ry + rh - r);
    ctx.arcTo(rx + rw, ry + rh, rx + rw - r, ry + rh, r);
    ctx.lineTo(rx + r, ry + rh);
    ctx.arcTo(rx,      ry + rh, rx,      ry + rh - r, r);
    ctx.lineTo(rx, ry + r);
    ctx.arcTo(rx,      ry,      rx + r, ry,            r);
    ctx.closePath();
  };

  // RECEIPT eyebrow
  eyebrow("RECEIPT", left, y + 12);
  y += 20;

  // Business name
  const displayName = venue ? `${name},` : name || "Unknown merchant";
  ctx.font = "italic 28px 'DM Serif Display', Georgia, serif";
  ctx.fillStyle = C.text;
  ctx.fillText(displayName, left, y + 28);
  y += 38;
  if (venue) {
    ctx.font = "italic 22px 'DM Serif Display', Georgia, serif";
    ctx.fillStyle = C.sub;
    ctx.fillText(`${venue}.`, left, y + 20);
    y += 24;
  }

  // Address + phone
  if (addressLines.length > 0) {
    ctx.font = "400 13px 'DM Sans', sans-serif";
    ctx.fillStyle = C.muted;
    for (const line of addressLines) {
      ctx.fillText(line, left, y + 14);
      y += 21;
    }
  }

  // Date
  ctx.font = "italic 13px 'DM Serif Display', Georgia, serif";
  ctx.fillStyle = C.muted;
  ctx.fillText(`${date} · ${time}`, left, y + 14);
  y += 21;

  // Divider
  y += 14;
  hairline(y);
  y += 20;

  // Amount (centred)
  const amountStr = formatAmountCents(receipt.amountCents);
  const currStr   = ` ${receipt.currency}`;
  ctx.font = "500 40px 'JetBrains Mono', monospace";
  const amW = ctx.measureText(amountStr).width;
  ctx.font = "400 20px 'JetBrains Mono', monospace";
  const cuW = ctx.measureText(currStr).width;
  const amX = PAD + IW / 2 - (amW + cuW) / 2;

  ctx.font = "500 40px 'JetBrains Mono', monospace";
  ctx.fillStyle = C.text;
  ctx.fillText(amountStr, amX, y + 42);
  ctx.font = "400 20px 'JetBrains Mono', monospace";
  ctx.fillStyle = C.tertiary;
  ctx.fillText(currStr, amX + amW, y + 42);
  y += 56;

  // Tax note
  ctx.font = "italic 13px 'DM Serif Display', Georgia, serif";
  ctx.fillStyle = C.muted;
  const taxNote = `incl. ${receipt.taxRatePercent}% tax`;
  ctx.fillText(taxNote, PAD + IW / 2 - ctx.measureText(taxNote).width / 2, y + 14);
  y += 24;
  // Subtotal/tip split — `amountCents` above is the grand total, so derive the
  // subtotal as `amountCents − tipCents`. Drawn only when the receipt was tipped.
  if (receipt.tipCents != null && receipt.tipCents > 0) {
    const subtotalCents = receipt.amountCents - receipt.tipCents;
    const tipNote = `Subtotal ${formatAmountCents(subtotalCents)} · Tip ${formatAmountCents(receipt.tipCents)} ${receipt.currency}`;
    ctx.font = "italic 13px 'DM Serif Display', Georgia, serif";
    ctx.fillStyle = C.tertiary;
    ctx.fillText(tipNote, PAD + IW / 2 - ctx.measureText(tipNote).width / 2, y + 14);
    y += 22;
  }

  // Divider
  y += 8;
  hairline(y);
  y += 20;

  // ITEMS eyebrow
  eyebrow("ITEMS", left, y + 12);
  y += 26;

  for (const item of receipt.items) {
    const lineTotalStr = `${formatAmountCents(itemLineTotalCents(item))} ${receipt.currency}`;

    ctx.font = "400 15px 'DM Serif Display', Georgia, serif";
    ctx.fillStyle = C.text;
    ctx.fillText(item.name, left, y + 16);

    ctx.font = "400 14px 'JetBrains Mono', monospace";
    ctx.fillStyle = C.sub;
    ctx.fillText(lineTotalStr, left + IW - ctx.measureText(lineTotalStr).width, y + 16);

    ctx.font = "400 11px 'DM Sans', sans-serif";
    ctx.fillStyle = C.tertiary;
    ctx.fillText(
      `${item.quantity} × ${formatAmountCents(item.unitPriceCents)} ${receipt.currency}`,
      left, y + 31,
    );

    y += 44;
  }

  // Divider
  y += 12;
  hairline(y);
  y += 20;

  // QR card
  if (qrImg) {
    const cardX = PAD + IW / 2 - QR_CARD_SIZE / 2;
    ctx.fillStyle = C.cardBg;
    rrect(cardX, y, QR_CARD_SIZE, QR_CARD_SIZE, 12);
    ctx.fill();
    ctx.drawImage(qrImg, cardX + QR_CARD_PAD, y + QR_CARD_PAD, QR_SIZE, QR_SIZE);
    y += QR_CARD_SIZE;

    ctx.font = "italic 12px 'DM Serif Display', Georgia, serif";
    ctx.fillStyle = C.tertiary;
    const cap = "The code from the printed slip.";
    ctx.fillText(cap, PAD + IW / 2 - ctx.measureText(cap).width / 2, y + 14);
    y += 18;

    y += 12;
    hairline(y);
    y += 20;
  }

  // RECEIPT DETAILS eyebrow
  eyebrow("RECEIPT DETAILS", left, y + 12);
  y += 26;

  for (const [label, value] of metaRows) {
    ctx.font = "400 11px 'DM Sans', sans-serif";
    ctx.fillStyle = C.tertiary;
    ctx.save();
    ctx.letterSpacing = "0.8px";
    ctx.fillText(label.toUpperCase(), left, y + 14);
    ctx.restore();

    ctx.font = "400 13px 'JetBrains Mono', monospace";
    ctx.fillStyle = C.text;
    // Truncate value if it would overflow.
    const maxW = IW - 90;
    let val = value;
    while (ctx.measureText(val).width > maxW && val.length > 4) {
      val = val.slice(0, -1);
    }
    if (val !== value) val = val.slice(0, -1) + "…";
    ctx.fillText(val, left + IW - ctx.measureText(val).width, y + 14);

    y += 26;
  }

  return canvas;
}

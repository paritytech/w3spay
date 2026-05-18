/**
 * Cashier-facing confirmation screen. Rendered after `coinPayment.
 * paymentRequest` resolves successfully. The customer holds the device up
 * so the cashier can read: merchant displayName, EUR amount, payment id
 * (RFC 6 PaymentId), and the primary on-chain transaction hash from the
 * clearing reference. A large green checkmark anchors the screen so the
 * cashier can confirm by eye without parsing details.
 */

import { formatEurCents } from "../fx/eur-to-pusd.ts";
import type { ParsedTseQr } from "../scan/tse-parser.ts";

export interface DoneViewModel {
  merchantDisplayName: string;
  terminalId: string;
  parsed: ParsedTseQr;
  paymentId: string;
  primaryTransactionHashHex: string;
}

export interface DoneCallbacks {
  onAcknowledge(): void;
}

export function renderDone(model: DoneViewModel): string {
  const eur = formatEurCents(model.parsed.amountEurCents);
  return `
    <section class="screen done-screen">
      <div class="check-stamp" aria-hidden="true">
        <svg viewBox="0 0 64 64" focusable="false" role="presentation">
          <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" stroke-width="3" />
          <path d="M18 33 L28 43 L46 23" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <header class="screen-head">
        <p class="screen-eyebrow">Paid</p>
        <h1 class="screen-title">€${escapeHtml(eur)}</h1>
        <p class="screen-subtitle">${escapeHtml(model.merchantDisplayName)} · Terminal ${escapeHtml(model.terminalId)}</p>
      </header>

      <dl class="receipt-meta">
        <div><dt>TSE serial</dt><dd>${escapeHtml(model.parsed.kassenSerial)}</dd></div>
        <div><dt>Transaction</dt><dd>${escapeHtml(model.parsed.transactionNumber)}</dd></div>
        <div><dt>Payment id</dt><dd class="mono">${escapeHtml(model.paymentId)}</dd></div>
        <div><dt>On-chain tx</dt><dd class="mono mono-wrap">${escapeHtml(model.primaryTransactionHashHex || "(pending)")}</dd></div>
      </dl>

      <p class="cashier-hint">Show this screen to the cashier.</p>

      <div class="actions">
        <button class="primary wide" data-action="acknowledge" type="button">New scan</button>
      </div>
    </section>
  `;
}

export function bindDoneEvents(root: HTMLElement, callbacks: DoneCallbacks): void {
  root.querySelector<HTMLButtonElement>("[data-action=acknowledge]")
    ?.addEventListener("click", () => callbacks.onAcknowledge(), { once: true });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

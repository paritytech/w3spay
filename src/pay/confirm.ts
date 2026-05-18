/**
 * The "you are about to pay X" pre-confirmation screen rendered after a
 * successful scan and before the host `paymentRequest` is issued. Renders
 * the parsed merchant + amount, and wires the "Confirm" / "Cancel" CTAs
 * back to the caller through a small `bindEvents` callback contract.
 */

import { formatEurCents, formatPusdSmallestUnit } from "../fx/eur-to-pusd.ts";
import type { ParsedTseQr } from "../scan/tse-parser.ts";

export interface ConfirmViewModel {
  merchantDisplayName: string;
  terminalId: string;
  parsed: ParsedTseQr;
  pusdAmountUnits: bigint;
  smartContractAddress: string;
}

export interface ConfirmCallbacks {
  onConfirm(): void;
  onCancel(): void;
}

export function renderConfirm(model: ConfirmViewModel): string {
  const eur = formatEurCents(model.parsed.amountEurCents);
  const pusd = formatPusdSmallestUnit(model.pusdAmountUnits);
  return `
    <section class="screen confirm-screen">
      <header class="screen-head">
        <p class="screen-eyebrow">Review payment</p>
        <h1 class="screen-title">${escapeHtml(model.merchantDisplayName)}</h1>
        <p class="screen-subtitle">Terminal ${escapeHtml(model.terminalId)}</p>
      </header>

      <section class="amount-card">
        <p class="amount-label">Receipt total</p>
        <p class="amount-primary">€${escapeHtml(eur)}</p>
        <p class="amount-secondary">≈ ${escapeHtml(pusd)} pUSD</p>
      </section>

      <dl class="receipt-meta">
        <div><dt>TSE serial</dt><dd>${escapeHtml(model.parsed.kassenSerial)}</dd></div>
        <div><dt>Transaction</dt><dd>${escapeHtml(model.parsed.transactionNumber)}</dd></div>
        <div><dt>Signature counter</dt><dd>${escapeHtml(model.parsed.signatureCounter)}</dd></div>
        <div><dt>Destination</dt><dd class="mono">${escapeHtml(model.smartContractAddress)}</dd></div>
      </dl>

      <div class="actions">
        <button class="secondary" data-action="cancel" type="button">Cancel</button>
        <button class="primary" data-action="confirm" type="button">Pay €${escapeHtml(eur)}</button>
      </div>
    </section>
  `;
}

export function bindConfirmEvents(root: HTMLElement, callbacks: ConfirmCallbacks): void {
  root.querySelector<HTMLButtonElement>("[data-action=confirm]")
    ?.addEventListener("click", () => callbacks.onConfirm(), { once: true });
  root.querySelector<HTMLButtonElement>("[data-action=cancel]")
    ?.addEventListener("click", () => callbacks.onCancel(), { once: true });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

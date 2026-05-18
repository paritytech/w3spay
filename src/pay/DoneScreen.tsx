import { formatEurCents } from "../fx/eur-to-pusd.ts";
import type { ParsedTseQr } from "../scan/tse-parser.ts";

export interface DoneScreenProps {
  merchantDisplayName: string;
  terminalId: string;
  parsed: ParsedTseQr;
  paymentId: string;
  onAcknowledge: () => void;
}

/**
 * Cashier-facing confirmation screen. RFC 0006 `host_payment_request`
 * returns only `{ id: string }` — no clearing reference or on-chain tx
 * hash. The on-screen acknowledgement is the cashier's signal.
 */
export function DoneScreen({
  merchantDisplayName,
  terminalId,
  parsed,
  paymentId,
  onAcknowledge,
}: DoneScreenProps) {
  const eur = formatEurCents(parsed.amountEurCents);
  return (
    <section className="screen done-screen">
      <div className="check-stamp" aria-hidden="true">
        <svg viewBox="0 0 64 64" focusable="false" role="presentation">
          <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="3" />
          <path
            d="M18 33 L28 43 L46 23"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <header className="screen-head">
        <p className="screen-eyebrow">Paid</p>
        <h1 className="screen-title">€{eur}</h1>
        <p className="screen-subtitle">
          {merchantDisplayName} · Terminal {terminalId}
        </p>
      </header>

      <dl className="receipt-meta">
        <div>
          <dt>TSE serial</dt>
          <dd>{parsed.kassenSerial}</dd>
        </div>
        <div>
          <dt>Transaction</dt>
          <dd>{parsed.transactionNumber}</dd>
        </div>
        <div>
          <dt>Payment id</dt>
          <dd className="mono mono-wrap">{paymentId}</dd>
        </div>
      </dl>

      <p className="cashier-hint">Show this screen to the cashier.</p>

      <div className="actions">
        <button className="primary wide" type="button" onClick={onAcknowledge}>
          New scan
        </button>
      </div>
    </section>
  );
}

import { formatEurCents, formatPusdSmallestUnit } from "../fx/eur-to-pusd.ts";
import type { ParsedTseQr } from "../scan/tse-parser.ts";
import type { PaymentBalanceState } from "../host/use-payment-balance.ts";

export interface ConfirmScreenProps {
  merchantDisplayName: string;
  terminalId: string;
  parsed: ParsedTseQr;
  pusdAmountUnits: bigint;
  smartContractAddress: string;
  balance: PaymentBalanceState;
  /** True only when balance is known AND strictly less than requested. */
  insufficient: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Pre-pay review screen. Shows what the customer is about to commit to:
 * merchant displayName, EUR amount from the TSE QR, locked pUSD conversion,
 * the resolved destination address, and the user's available pUSD balance.
 *
 * The Pay button is gated only when the host has actually told us the
 * balance and it's strictly insufficient. Pending / permission-denied /
 * unsupported balances fail open — the host's own `InsufficientBalance`
 * error path on `paymentRequest` is the final authority.
 */
export function ConfirmScreen({
  merchantDisplayName,
  terminalId,
  parsed,
  pusdAmountUnits,
  smartContractAddress,
  balance,
  insufficient,
  onConfirm,
  onCancel,
}: ConfirmScreenProps) {
  const eur = formatEurCents(parsed.amountEurCents);
  const pusd = formatPusdSmallestUnit(pusdAmountUnits);
  return (
    <section className="screen confirm-screen">
      <header className="screen-head">
        <p className="screen-eyebrow">Review payment</p>
        <h1 className="screen-title">{merchantDisplayName}</h1>
        <p className="screen-subtitle">Terminal {terminalId}</p>
      </header>

      <section className="amount-card">
        <p className="amount-label">Receipt total</p>
        <p className="amount-primary">€{eur}</p>
        <p className="amount-secondary">≈ {pusd} pUSD</p>
      </section>

      <BalanceRow balance={balance} insufficient={insufficient} />

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
          <dt>Signature counter</dt>
          <dd>{parsed.signatureCounter}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd className="mono mono-wrap">{smartContractAddress}</dd>
        </div>
      </dl>

      <div className="actions">
        <button className="secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary"
          type="button"
          onClick={onConfirm}
          disabled={insufficient}
          aria-disabled={insufficient}
        >
          {insufficient ? "Insufficient balance" : `Pay €${eur}`}
        </button>
      </div>
    </section>
  );
}

interface BalanceRowProps {
  balance: PaymentBalanceState;
  insufficient: boolean;
}

function BalanceRow({ balance, insufficient }: BalanceRowProps) {
  if (balance.kind === "available") {
    const label = formatPusdSmallestUnit(balance.availableUnits);
    return (
      <p
        className={`balance-row ${insufficient ? "balance-row--insufficient" : ""}`}
      >
        {insufficient ? "Available balance" : "Your balance"}: {label} pUSD
        {insufficient ? " — top up to continue." : ""}
      </p>
    );
  }
  if (balance.kind === "pending") {
    return <p className="balance-row balance-row--muted">Checking balance…</p>;
  }
  if (balance.kind === "permissionDenied") {
    return (
      <p className="balance-row balance-row--muted">
        Balance check unavailable (permission denied). Payment will still
        verify funds with the host.
      </p>
    );
  }
  if (balance.kind === "unsupported") {
    return null;
  }
  return (
    <p className="balance-row balance-row--muted">
      Balance check unavailable ({balance.reason}). Payment will still verify
      funds with the host.
    </p>
  );
}

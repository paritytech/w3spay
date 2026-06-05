/**
 * Dev-only manual-payment surface. Four small views, one per dev stage,
 * gated behind `envConfig.features.devPaymentOverride` (see
 * `src/config.ts`).
 *
 *   - `<DevPayScreen>`     — the form. AccountId32 hex + CASH amount,
 *     Pay button disabled until both fields parse.
 *   - `<DevPayingView>`    — interstitial while `host.paymentRequest`
 *     is in flight.
 *   - `<DevDoneView>`      — success; offers a fresh dev payment or
 *     return to the scanner.
 *   - `<DevPayErrorView>`  — failure surface with a retry into the form.
 *
 * Co-located in one file because they share the same dev-only concern
 * and never render in any prod-shipped build path. NEVER reuse these
 * for the live TSE-scan flow — synthesizing `ParsedTseQr`/`MerchantEntry`
 * here would silently corrupt the audit trail.
 */

import { useState } from "react";

import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  Icon,
  MetaRow,
  PrimaryButton,
  SecondaryButton,
  Sub,
} from "@/shared/components/primitives.tsx";
import { Spinner } from "@/shared/components/Spinner.tsx";
import {
  parseDevAccountIdInput,
  parseDevCashAmountInput,
  sanitizeDevCashInput,
  shortenDevDestination,
} from "@/features/payment/lib/dev-payment.ts";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import { ASSET_LABEL } from "@/shared/utils/format.ts";

// ─── Form ──────────────────────────────────────────────────────────────

export interface DevPayScreenProps {
  /** Vault's available balance in cents, or `null` while recovering. */
  availableBalanceCents: number | null;
  /** Commit a dev payment. The caller has already validated both fields. */
  onPay: (destinationHex: string, amountCents: number) => void;
  /** Return to the scanner without paying. */
  onCancel: () => void;
}

export function DevPayScreen({
  availableBalanceCents,
  onPay,
  onCancel,
}: DevPayScreenProps) {
  const [addressRaw, setAddressRaw] = useState<string>("");
  const [amountRaw, setAmountRaw] = useState<string>("");

  const parsedAddress = parseDevAccountIdInput(addressRaw);
  const parsedCents = parseDevCashAmountInput(amountRaw);
  const addressShowError = addressRaw.trim().length > 0 && parsedAddress === null;
  const amountShowError = amountRaw.trim().length > 0 && parsedCents === null;

  const insufficient =
    parsedCents !== null &&
    availableBalanceCents !== null &&
    availableBalanceCents < parsedCents;

  const canPay =
    parsedAddress !== null && parsedCents !== null && !insufficient;

  return (
    <Frame
      footer={
        <div className="btn-row">
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton
            disabled={!canPay}
            onClick={() => {
              if (parsedAddress !== null && parsedCents !== null && !insufficient) {
                onPay(parsedAddress, parsedCents);
              }
            }}
          >
            Pay{parsedCents !== null ? ` · ${formatAmountCents(parsedCents)} ${ASSET_LABEL}` : ""}
          </PrimaryButton>
        </div>
      }
    >
      <Eyebrow tone="warn">Dev override</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={40} suffix="payment." suffixTone="warn">
          Manual
        </Head>
      </div>
      <Dotted style={{ marginTop: 18 }} />
      <Sub small>
        Sends straight to an AccountId32 — bypasses the TSE scan. For dev
        testing only.
      </Sub>

      <div className="dev-pay__field">
        <label className="dev-pay__label" htmlFor="dev-pay-address">
          AccountId32 · SS58 or 0x-hex
        </label>
        <input
          id="dev-pay-address"
          className={
            addressShowError ? "dev-pay__input dev-pay__input--error" : "dev-pay__input"
          }
          value={addressRaw}
          onChange={(e) => setAddressRaw(e.target.value)}
          placeholder="0x0000000000000000000000000000000000000000000000000000000000000000"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          inputMode="text"
          aria-label="AccountId32 destination as SS58 or 0x-prefixed hex"
          aria-invalid={addressShowError || undefined}
        />
        {addressShowError ? (
          <p className="dev-pay__hint dev-pay__hint--error">
            Expected an SS58 address or `0x` + exactly 64 hex characters.
          </p>
        ) : (
          <p className="dev-pay__hint">
            Paste the SS58 address or the raw 32-byte hex.
          </p>
        )}
      </div>

      <div className="dev-pay__field">
        <label className="dev-pay__label" htmlFor="dev-pay-amount">
          Amount · {ASSET_LABEL}
        </label>
        <div className="dev-pay__amount-row">
          <span className="dev-pay__amount-ticker">{ASSET_LABEL}</span>
          <input
            id="dev-pay-amount"
            className={
              amountShowError
                ? "dev-pay__input dev-pay__amount-input dev-pay__input--error"
                : "dev-pay__input dev-pay__amount-input"
            }
            value={amountRaw}
            onChange={(e) => setAmountRaw(sanitizeDevCashInput(e.target.value))}
            placeholder="0.01"
            inputMode="decimal"
            aria-label={`Amount to send in ${ASSET_LABEL}`}
            aria-invalid={amountShowError || undefined}
          />
        </div>
        {amountShowError ? (
          <p className="dev-pay__hint dev-pay__hint--error">
            Enter a positive amount, up to 2 decimal places.
          </p>
        ) : insufficient ? (
          <p className="dev-pay__hint dev-pay__hint--error">
            Above the vault balance.
          </p>
        ) : (
          <p className="dev-pay__hint">
            Cents only. 1:1 with cents on the host wire.
          </p>
        )}
      </div>

      <div style={{ flex: 1 }} />
      <Dotted />
      <dl style={{ margin: 0 }}>
        <MetaRow
          label="Balance"
          value={
            availableBalanceCents !== null
              ? `${formatAmountCents(availableBalanceCents)} ${ASSET_LABEL}`
              : "—"
          }
          mono
        />
      </dl>
    </Frame>
  );
}

// ─── In-flight ─────────────────────────────────────────────────────────

export interface DevPayingViewProps {
  amountCents: number;
  destinationHex: string;
}

export function DevPayingView({ amountCents, destinationHex }: DevPayingViewProps) {
  return (
    <Frame>
      <Eyebrow tone="warn">Dev override</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={56} italic>
          Paying.
        </Head>
      </div>
      <Dotted style={{ marginTop: 18 }} />
      <Sub>
        Sending to the address you entered — this usually takes a few{" "}
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>
          seconds
        </span>
        .
      </Sub>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
        <Spinner size={32} />
      </div>
      <dl style={{ padding: "14px 0 24px", margin: 0 }}>
        <MetaRow label="To" value={shortenDevDestination(destinationHex)} mono />
        <MetaRow
          label="Amount"
          value={`${formatAmountCents(amountCents)} ${ASSET_LABEL}`}
          mono
        />
      </dl>
    </Frame>
  );
}

// ─── Done ──────────────────────────────────────────────────────────────

export interface DevDoneViewProps {
  amountCents: number;
  destinationHex: string;
  paymentId: string;
  onAcknowledge: () => void;
  onAnother: () => void;
}

export function DevDoneView({
  amountCents,
  destinationHex,
  paymentId,
  onAcknowledge,
  onAnother,
}: DevDoneViewProps) {
  return (
    <Frame
      footer={
        <div className="btn-row">
          <SecondaryButton onClick={onAnother}>Another</SecondaryButton>
          <PrimaryButton onClick={onAcknowledge}>
            <Icon name="scan" size={16} />
            Done
          </PrimaryButton>
        </div>
      }
    >
      <Eyebrow tone="success">Dev override · paid</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={44} italic>
          Sent.
        </Head>
      </div>
      <Dotted style={{ marginTop: 18 }} />
      <Sub small>
        The host accepted the extrinsic. Inspect the chain explorer for
        on-chain confirmation.
      </Sub>
      <div style={{ flex: 1 }} />
      <Dotted />
      <dl style={{ margin: 0 }}>
        <MetaRow
          label="Amount"
          value={`${formatAmountCents(amountCents)} ${ASSET_LABEL}`}
          mono
        />
        <MetaRow label="To" value={shortenDevDestination(destinationHex)} mono />
      </dl>
      <div style={{ marginTop: 14 }}>
        <CopyableId
          label="Transaction"
          value={paymentId}
          hint="Returned by the host. Use it to look up the extrinsic in the chain explorer."
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <CopyableId label="To (AccountId32 hex)" value={destinationHex} />
      </div>
      <div style={{ paddingBottom: 6 }} />
    </Frame>
  );
}

// ─── Copyable id (dev-only) ────────────────────────────────────────────

interface CopyableIdProps {
  label: string;
  value: string;
  /** Optional single-line caption rendered above the value. */
  hint?: string;
}

/**
 * Editorial copy-to-clipboard row. The whole row + the trailing button
 * trigger the copy; the inline confirmation flips for ~1.5s so the user
 * sees a positive ack even on hosts whose webviews suppress toast UX.
 *
 * Uses the modern Clipboard API where available and falls back to a
 * hidden `<textarea>` + `document.execCommand("copy")` so Android
 * webviews on older system Chrome still work.
 */
function CopyableId({ label, value, hint }: CopyableIdProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    setFailed(false);
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard != null &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(value);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.pointerEvents = "none";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand copy returned false");
      } else {
        throw new Error("no clipboard API available");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("[w3spay/dev] clipboard write failed", err);
      setFailed(true);
      window.setTimeout(() => setFailed(false), 2000);
    }
  };

  return (
    <div className="dev-pay__copyrow">
      <div className="dev-pay__copyrow-head">
        <span className="dev-pay__copyrow-label">{label}</span>
        <button
          type="button"
          className="dev-pay__copyrow-action"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? (
            <>
              <Icon name="check" size={12} />
              <span>Copied</span>
            </>
          ) : failed ? (
            <>
              <Icon name="x" size={12} />
              <span>Failed</span>
            </>
          ) : (
            <>
              <Icon name="copy" size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {hint ? <p className="dev-pay__copyrow-hint">{hint}</p> : null}
      <div className="dev-pay__copyrow-value">{value}</div>
    </div>
  );
}

// ─── Error ─────────────────────────────────────────────────────────────

export interface DevPayErrorViewProps {
  message: string;
  amountCents: number;
  destinationHex: string;
  onRetry: () => void;
  onCancel: () => void;
}

export function DevPayErrorView({
  message,
  amountCents,
  destinationHex,
  onRetry,
  onCancel,
}: DevPayErrorViewProps) {
  return (
    <Frame
      footer={
        <div className="btn-row">
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton onClick={onRetry}>Retry</PrimaryButton>
        </div>
      }
    >
      <Eyebrow tone="danger">Dev override · failed</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={40} suffix="couldn't go through." suffixTone="danger">
          Payment
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub small>{message}</Sub>
      <div style={{ flex: 1 }} />
      <Dotted />
      <dl style={{ margin: 0 }}>
        <MetaRow
          label="Amount"
          value={`${formatAmountCents(amountCents)} ${ASSET_LABEL}`}
          mono
        />
        <MetaRow label="To" value={shortenDevDestination(destinationHex)} mono />
      </dl>
      <div style={{ paddingBottom: 6 }} />
    </Frame>
  );
}

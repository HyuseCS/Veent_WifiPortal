# Runbook — payment credit mismatch (stranded funds)

**Alert:** Sentry issue tagged `area=payment scope=credit`, with `reason=amount_mismatch` or
`reason=currency_mismatch`.

## What it means

A buyer was charged at Maya, but the charge did **not** match the checkout we created:

- `amount_mismatch` — the gateway amount ≠ the checkout's recorded amount (underpayment, partial
  capture, or a `fiatCost` edited under a stale checkout).
- `currency_mismatch` — the gateway charged in a non-PHP currency (the portal settles PHP-only).

To stop an infinite retry loop, the checkout is marked **`settled`** but **not credited** — so the buyer
has paid and received nothing. This is a fail-closed money-integrity stop, **not** an attack. It requires
manual remediation; there is no automatic refund.

(Contrast: a *non-finite / unparseable* gateway amount is left `pending` and auto-retried — that path does
not alert here.)

## Investigate

1. From the Sentry `extra`: note `checkoutId`, `externalTransactionId`, `expectedMinor`, `gotMinor`,
   `currency`.
2. `payment_checkouts` — look up `checkoutId`: confirm the recorded `amount` and that `status='settled'`.
3. `payment_transactions` — find the row by `externalTransactionId` / reference; confirm the actual charged
   amount + currency.
4. Maya dashboard — confirm the real charge (amount, currency, status) against the checkout.

## Remediate (choose one)

- **Manual credit** (buyer keeps the purchase): grant the package via `addCredits` keyed on the **same
  `externalTransactionId`**. The idempotency guard means a later webhook/reconcile replay can't
  double-credit.
- **Refund** (charge was wrong): refund the mismatched charge in the Maya dashboard. Leave the checkout
  `settled`.

## Close

Annotate the Finance record with the action taken, then resolve the Sentry issue.

## Prevent

Repeated `amount_mismatch` on active bundles usually means a price (`fiatCost`) was edited while a checkout
was in flight — prefer versioning/retiring a bundle over editing its price live.

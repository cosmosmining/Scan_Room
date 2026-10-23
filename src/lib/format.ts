import type { Currency } from './types';

/** Minor units (e.g. cents) → localized currency string. */
export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(minor / 100);
}

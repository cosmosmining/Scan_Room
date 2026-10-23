export type Currency = 'USD' | 'EUR' | 'GBP';

export interface PriceLineItem {
  moduleInstanceId: string;
  definitionId: string;
  label: string; // e.g. "Base cabinet 600mm — Oak"
  basePrice: number;
  finishDelta: number;
  optionsDelta: number;
  quantity: number;
  /** (base + finishDelta + optionsDelta) * quantity. */
  subtotal: number;
}

/** An itemized project add-on (lighting, handles, services). */
export interface PriceAddOnLine {
  addOnId: string;
  label: string;
  detail?: string; // e.g. "5.4 m × $24/m"
  amount: number;
}

export type PriceModifierKind = 'discount' | 'surcharge' | 'tax' | 'delivery';

export interface PriceModifier {
  id: string;
  label: string; // "Trade discount", "VAT 20%"
  kind: PriceModifierKind;
  /** Flat amount in minor currency units. */
  amount?: number;
  /** Rate, e.g. 0.2 = 20%. */
  rate?: number;
}

export interface PriceBreakdown {
  currency: Currency;
  /** Module line items (cabinets, appliances, worktops, accessories). */
  lineItems: PriceLineItem[];
  itemsSubtotal: number;
  /** Project add-ons (lighting, handles, services). */
  addOns: PriceAddOnLine[];
  addOnsSubtotal: number;
  /** Installation estimate. */
  installation: number;
  /** Tax, delivery, discounts — applied after items + add-ons + installation. */
  modifiers: PriceModifier[];
  total: number;
  /** Ties the price to the exact layout version it priced. */
  layoutVersion: number;
  computedAt: string;
}

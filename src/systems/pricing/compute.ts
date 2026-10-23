import { DEFAULT_CURRENCY } from '@/lib/constants';
import type {
  Currency,
  ModuleCategory,
  ModuleDefinition,
  PriceAddOnLine,
  PriceBreakdown,
  PriceLineItem,
  PriceModifier,
} from '@/lib/types';
import type { AddOn, Catalog, StylePreset, SurfaceRole } from '@/systems/catalog';
import {
  flatten,
  resolveNodeMaterials,
  type ConfigNode,
  type ProjectConfiguration,
} from '@/systems/config';

export interface PricingOptions {
  currency?: Currency;
  taxRate?: number; // e.g. 0.2 for 20%
  deliveryFlat?: number; // minor units
  installFlat?: number; // call-out fee, minor units
  installPerModule?: number; // per cabinet, minor units
  layoutVersion?: number;
}

export function createEmptyBreakdown(): PriceBreakdown {
  return {
    currency: DEFAULT_CURRENCY,
    lineItems: [],
    itemsSubtotal: 0,
    addOns: [],
    addOnsSubtotal: 0,
    installation: 0,
    modifiers: [],
    total: 0,
    layoutVersion: 0,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Pricing model.
 *
 *   line        = base(width) × frontMaterialMultiplier + worktopArea + handle + options
 *   items       = Σ lines
 *   addOns      = flat | per-module × cabinets | per-meter × run length
 *   installation= callout + perModule × cabinets
 *   preTax      = items + addOns + installation
 *   total       = preTax + delivery + tax(preTax)
 *
 * Fully parametric — width, material, options, and add-on selection all move the
 * number. Runs client-side now; identical code can run server-side for the
 * authoritative quote.
 */
export function computePricing(
  config: ProjectConfiguration,
  catalog: Catalog,
  options: PricingOptions = {},
): PriceBreakdown {
  const currency = options.currency ?? DEFAULT_CURRENCY;
  const style = catalog.styles[config.styleId];

  const lineItems: PriceLineItem[] = [];
  let cabinetCount = 0;
  let runMm = 0;

  for (const node of flatten(config.moduleTree)) {
    if (!node.definitionId) continue;
    const def = catalog.definitions[node.definitionId];
    if (!def || !style) continue;
    lineItems.push(priceNode(node, def, style, config.materialOverrides, catalog));
    if (frontBearing(def.category)) {
      cabinetCount += 1;
      runMm += node.width ?? def.dimensions.width;
    }
  }

  const ctx: AddOnContext = { cabinetCount, runMeters: runMm / 1000 };
  const addOns = config.selectedAddOnIds
    .map((id) => catalog.addOns[id])
    .filter((a): a is AddOn => Boolean(a))
    .map((a) => priceAddOn(a, ctx));

  const itemsSubtotal = sum(lineItems.map((li) => li.subtotal));
  const addOnsSubtotal = sum(addOns.map((a) => a.amount));
  const installation =
    cabinetCount > 0
      ? (options.installFlat ?? 0) + (options.installPerModule ?? 0) * cabinetCount
      : 0;

  const preTax = itemsSubtotal + addOnsSubtotal + installation;
  const { modifiers, addedTotal } =
    preTax > 0
      ? buildTaxAndDelivery(preTax, options)
      : { modifiers: [], addedTotal: 0 };

  return {
    currency,
    lineItems,
    itemsSubtotal,
    addOns,
    addOnsSubtotal,
    installation,
    modifiers,
    total: preTax + addedTotal,
    layoutVersion: options.layoutVersion ?? 0,
    computedAt: new Date().toISOString(),
  };
}

// ── modules ──────────────────────────────────────────────────────────────────

function priceNode(
  node: ConfigNode,
  def: ModuleDefinition,
  style: StylePreset,
  globalOverrides: ProjectConfiguration['materialOverrides'],
  catalog: Catalog,
): PriceLineItem {
  const width = node.width ?? def.dimensions.width;
  const parametricBase = def.widthRange
    ? Math.round(def.basePrice * (width / def.dimensions.width))
    : def.basePrice;

  const materials = resolveNodeMaterials(node, style, globalOverrides);

  // Front material multiplies the base cost (only for front-bearing modules).
  const multiplier = frontBearing(def.category)
    ? catalog.materials[materials.front]?.multiplier ?? 1
    : 1;
  const baseWithMaterial = Math.round(parametricBase * multiplier);

  const surfaceDelta = materialSurfaceCost(def, width, materials, catalog);
  const optionsDelta = node.selectedOptionIds.reduce((s, id) => {
    const opt = def.options.find((o) => o.id === id);
    return s + (opt?.priceDelta ?? 0);
  }, 0);

  return {
    moduleInstanceId: node.id,
    definitionId: def.id,
    label: node.width ? `${def.name} (${width}mm)` : def.name,
    basePrice: parametricBase,
    finishDelta: baseWithMaterial - parametricBase + surfaceDelta,
    optionsDelta,
    quantity: 1,
    subtotal: baseWithMaterial + surfaceDelta + optionsDelta,
  };
}

function rolesForCategory(category: ModuleCategory): SurfaceRole[] {
  switch (category) {
    case 'worktop':
      return ['worktop'];
    case 'kitchen-base':
    case 'kitchen-wall':
    case 'kitchen-tall':
    case 'wardrobe-frame':
      return ['carcass', 'front', 'handle'];
    case 'wardrobe-internal':
      return ['carcass'];
    default:
      return [];
  }
}

const frontBearing = (category: ModuleCategory): boolean =>
  rolesForCategory(category).includes('front');

/** Worktop (area-billed) + handle (flat). Front/carcass are in the multiplier. */
function materialSurfaceCost(
  def: ModuleDefinition,
  width: number,
  materials: Record<SurfaceRole, string>,
  catalog: Catalog,
): number {
  let cost = 0;
  for (const role of rolesForCategory(def.category)) {
    const material = catalog.materials[materials[role]];
    if (!material) continue;
    if (role === 'worktop' && material.pricePerSqM) {
      cost += Math.round(roleArea(def, width) * material.pricePerSqM);
    } else if (role === 'handle' && material.surcharge) {
      cost += material.surcharge;
    }
  }
  return cost;
}

/** Worktop area (m²) from live dimensions. */
const roleArea = (def: ModuleDefinition, width: number): number =>
  (width / 1000) * (def.dimensions.depth / 1000);

// ── add-ons ──────────────────────────────────────────────────────────────────

interface AddOnContext {
  cabinetCount: number;
  runMeters: number;
}

function priceAddOn(addOn: AddOn, ctx: AddOnContext): PriceAddOnLine {
  const p = addOn.pricing;
  if (p.kind === 'flat') {
    return { addOnId: addOn.id, label: addOn.name, amount: p.amount, detail: 'one-off' };
  }
  if (p.kind === 'per-module') {
    return {
      addOnId: addOn.id,
      label: addOn.name,
      amount: p.amount * ctx.cabinetCount,
      detail: `${ctx.cabinetCount} modules`,
    };
  }
  return {
    addOnId: addOn.id,
    label: addOn.name,
    amount: Math.round(p.amount * ctx.runMeters),
    detail: `${ctx.runMeters.toFixed(1)} m run`,
  };
}

// ── tax / delivery ───────────────────────────────────────────────────────────

function buildTaxAndDelivery(
  preTax: number,
  options: PricingOptions,
): { modifiers: PriceModifier[]; addedTotal: number } {
  const modifiers: PriceModifier[] = [];
  let added = 0;

  if (options.deliveryFlat) {
    modifiers.push({ id: 'delivery', label: 'Delivery', kind: 'delivery', amount: options.deliveryFlat });
    added += options.deliveryFlat;
  }
  if (options.taxRate) {
    modifiers.push({
      id: 'tax',
      label: `Tax ${Math.round(options.taxRate * 100)}%`,
      kind: 'tax',
      rate: options.taxRate,
    });
    added += Math.round(preTax * options.taxRate);
  }
  return { modifiers, addedTotal: added };
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

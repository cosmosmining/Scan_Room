/**
 * MOZU's finish library — the same swatches the iPad app carries, in the same
 * order: `SwatchCatalog.builtIn` (room surfaces) followed by the 48 imported
 * MOZU collections generated from
 * `apps/ios/MozuScanner/Design/Model/MozuFinishes.swift`. A customer who picks
 * Walnut 02 on an iPad and Walnut 02 in a browser must be picking the same
 * material, or the quote is wrong.
 *
 * `color` is the swatch's average colour — what the iPad's `MaterialFactory`
 * falls back to when a bitmap is missing, and what the 2D plan fills with so it
 * needn't sample a texture.
 */

export type SwatchCategory =
  | 'color' | 'wood' | 'hue' | 'glossy' | 'touch' | 'fabric' | 'real'
  | 'marble' | 'granite' | 'tile' | 'finishes';

export interface Swatch {
  id: string;
  name: string;
  category: SwatchCategory;
  /** Texture file stem, when the swatch is image-based. */
  texture: string | null;
  /** Average colour, hex. */
  color: string;
}

/**
 * How a surface behaves, not what colour it is — the same seven the iPad offers.
 * Roughness and metalness are lifted straight from `SurfaceMaterialKind.pbr` so a
 * gloss door looks like a gloss door in both renderers.
 */
export type MaterialKind =
  | 'matte' | 'plastic' | 'fabric' | 'metal' | 'mirror' | 'glass' | 'polished';

export const MATERIAL_KINDS: {
  id: MaterialKind; label: string; roughness: number; metalness: number; opacity: number;
}[] = [
  { id: 'matte', label: 'Default', roughness: 0.85, metalness: 0, opacity: 1 },
  { id: 'plastic', label: 'Plastic', roughness: 0.45, metalness: 0, opacity: 1 },
  { id: 'fabric', label: 'Fabric', roughness: 0.95, metalness: 0, opacity: 1 },
  { id: 'metal', label: 'Metal', roughness: 0.3, metalness: 1, opacity: 1 },
  { id: 'mirror', label: 'Mirror', roughness: 0.02, metalness: 1, opacity: 1 },
  { id: 'glass', label: 'Glass', roughness: 0.05, metalness: 0, opacity: 0.35 },
  { id: 'polished', label: 'Polished', roughness: 0.12, metalness: 0.2, opacity: 1 },
];

/** What a finish applies to. Mirrors the iPad's `FinishTarget`. */
export type FinishTarget =
  | { kind: 'item'; id: string }
  | { kind: 'wall' } | { kind: 'floor' } | { kind: 'ceiling' };

export interface SurfaceFinish {
  swatchId: string;
  kind: MaterialKind;
  /** Texture repeat. 1 = as authored. */
  textureScale: number;
  /** Texture rotation, radians. */
  rotation: number;
  /** Optional tint over the swatch, hex. */
  tint?: string;
}

export const SWATCH_CATEGORIES: SwatchCategory[] = [
  'color', 'wood', 'hue', 'glossy', 'touch', 'fabric', 'real',
  'marble', 'granite', 'tile', 'finishes',
];

/**
 * `SwatchCatalog.builtIn` — the room-surface swatches. These are the ones the
 * iPad reaches for by default (plaster walls, an oak floor), which is why a
 * scanned room there reads as a room and not as grey cardboard.
 */
const BUILT_IN: Swatch[] = [
  { id: 'marble_cream', name: 'Cream Marble', category: 'marble', texture: 'marble_cream', color: '#eae3d1' },
  { id: 'marble_white', name: 'Grey Marble', category: 'marble', texture: 'marble_white', color: '#cccfd4' },
  { id: 'oak', name: 'Oak', category: 'wood', texture: 'oak', color: '#bd9463' },
  { id: 'walnut', name: 'Walnut', category: 'wood', texture: 'walnut', color: '#66452e' },
  { id: 'tile_ceramic', name: 'Ceramic Tile', category: 'tile', texture: 'tile_ceramic', color: '#dbdbd6' },
  { id: 'granite_grey', name: 'Grey Granite', category: 'granite', texture: 'granite_grey', color: '#858587' },
  { id: 'granite_black', name: 'Black Granite', category: 'granite', texture: 'granite_black', color: '#2e2e33' },
  { id: 'plaster', name: 'Plaster', category: 'finishes', texture: 'plaster', color: '#e6e1d9' },
  { id: 'col_white', name: 'White', category: 'color', texture: null, color: '#f2f2ed' },
  { id: 'col_beige', name: 'Beige', category: 'color', texture: null, color: '#d6c7ab' },
  { id: 'col_sage', name: 'Sage', category: 'color', texture: null, color: '#9eae94' },
  { id: 'col_charcoal', name: 'Charcoal', category: 'color', texture: null, color: '#404247' },
  { id: 'col_navy', name: 'Navy', category: 'color', texture: null, color: '#334566' },
  { id: 'col_terracotta', name: 'Terracotta', category: 'color', texture: null, color: '#c97357' },
];

const MOZU_SWATCHES: Swatch[] = [
  { id: 'mozu_wood_ash_01', name: 'Ash 01', category: 'wood', texture: 'mozu_wood_ash_01', color: '#8d7463' },
  { id: 'mozu_wood_cherry_01', name: 'Cherry 01', category: 'wood', texture: 'mozu_wood_cherry_01', color: '#d9a16a' },
  { id: 'mozu_wood_oak_01', name: 'Oak 01', category: 'wood', texture: 'mozu_wood_oak_01', color: '#c1a185' },
  { id: 'mozu_wood_oak_02', name: 'Oak 02', category: 'wood', texture: 'mozu_wood_oak_02', color: '#3f302e' },
  { id: 'mozu_wood_oak_03', name: 'Oak 03', category: 'wood', texture: 'mozu_wood_oak_03', color: '#d8a269' },
  { id: 'mozu_wood_oak_04', name: 'Oak 04', category: 'wood', texture: 'mozu_wood_oak_04', color: '#ac8d67' },
  { id: 'mozu_wood_oak_05', name: 'Oak 05', category: 'wood', texture: 'mozu_wood_oak_05', color: '#5b473c' },
  { id: 'mozu_wood_oak_06', name: 'Oak 06', category: 'wood', texture: 'mozu_wood_oak_06', color: '#b59571' },
  { id: 'mozu_wood_oak_07', name: 'Oak 07', category: 'wood', texture: 'mozu_wood_oak_07', color: '#383838' },
  { id: 'mozu_wood_oak_08', name: 'Oak 08', category: 'wood', texture: 'mozu_wood_oak_08', color: '#cda880' },
  { id: 'mozu_wood_oak_09', name: 'Oak 09', category: 'wood', texture: 'mozu_wood_oak_09', color: '#896e58' },
  { id: 'mozu_wood_walnut_01', name: 'Walnut 01', category: 'wood', texture: 'mozu_wood_walnut_01', color: '#b7997a' },
  { id: 'mozu_wood_walnut_02', name: 'Walnut 02', category: 'wood', texture: 'mozu_wood_walnut_02', color: '#7d6353' },
  { id: 'mozu_wood_walnut_03', name: 'Walnut 03', category: 'wood', texture: 'mozu_wood_walnut_03', color: '#765742' },
  { id: 'mozu_wood_wenge_01', name: 'Wenge 01', category: 'wood', texture: 'mozu_wood_wenge_01', color: '#92837e' },
  { id: 'mozu_glossy_01', name: 'Glossy 01', category: 'glossy', texture: null, color: '#ededeb' },
  { id: 'mozu_glossy_02', name: 'Glossy 02', category: 'glossy', texture: null, color: '#e0dfdd' },
  { id: 'mozu_glossy_03', name: 'Glossy 03', category: 'glossy', texture: null, color: '#d9d1c7' },
  { id: 'mozu_glossy_04', name: 'Glossy 04', category: 'glossy', texture: null, color: '#584f46' },
  { id: 'mozu_glossy_05', name: 'Glossy 05', category: 'glossy', texture: null, color: '#4e5255' },
  { id: 'mozu_glossy_6', name: 'Glossy 6', category: 'glossy', texture: null, color: '#543733' },
  { id: 'mozu_hue_1_1', name: 'Hue 1-1', category: 'hue', texture: null, color: '#faf7f6' },
  { id: 'mozu_hue_2_1', name: 'Hue 2-1', category: 'hue', texture: null, color: '#f6eee4' },
  { id: 'mozu_hue_2_4', name: 'Hue 2-4', category: 'hue', texture: null, color: '#d5c8bc' },
  { id: 'mozu_hue_2_5', name: 'Hue 2-5', category: 'hue', texture: null, color: '#baaa9c' },
  { id: 'mozu_hue_4_1', name: 'Hue 4-1', category: 'hue', texture: null, color: '#4f4f4f' },
  { id: 'mozu_hue_4_2', name: 'Hue 4-2', category: 'hue', texture: null, color: '#282829' },
  { id: 'mozu_hue_5_1', name: 'Hue 5-1', category: 'hue', texture: null, color: '#542e2b' },
  { id: 'mozu_hue_leather_01_01', name: 'Hue Leather 01-01', category: 'hue', texture: 'mozu_hue_leather_01_01', color: '#c0bab4' },
  { id: 'mozu_hue_leather_01_02', name: 'Hue Leather 01-02', category: 'hue', texture: 'mozu_hue_leather_01_02', color: '#5d5553' },
  { id: 'mozu_hue_metalic_01_02', name: 'Hue Metalic 01-02', category: 'hue', texture: null, color: '#7a6852' },
  { id: 'mozu_hue_metalic_1_1', name: 'Hue Metalic 1-1', category: 'hue', texture: null, color: '#947848' },
  { id: 'mozu_touch_01', name: 'Touch 01', category: 'touch', texture: null, color: '#e0dfdd' },
  { id: 'mozu_touch_02', name: 'Touch 02', category: 'touch', texture: null, color: '#d9d1c7' },
  { id: 'mozu_touch_03', name: 'Touch 03', category: 'touch', texture: null, color: '#afa28f' },
  { id: 'mozu_touch_04', name: 'Touch 04', category: 'touch', texture: null, color: '#584f46' },
  { id: 'mozu_touch_05', name: 'Touch 05', category: 'touch', texture: null, color: '#4e5255' },
  { id: 'mozu_fabric_01', name: 'Fabric 01', category: 'fabric', texture: 'mozu_fabric_01', color: '#c4c1b7' },
  { id: 'mozu_fabric_02', name: 'Fabric 02', category: 'fabric', texture: 'mozu_fabric_02', color: '#cac3bb' },
  { id: 'mozu_fabric_03', name: 'Fabric 03', category: 'fabric', texture: 'mozu_fabric_03', color: '#e4d9c9' },
  { id: 'mozu_fabric_04_01', name: 'Fabric 04-01', category: 'fabric', texture: 'mozu_fabric_04_01', color: '#ccc9bd' },
  { id: 'mozu_fabric_04_02', name: 'Fabric 04-02', category: 'fabric', texture: 'mozu_fabric_04_02', color: '#a09989' },
  { id: 'mozu_fabric_05', name: 'Fabric 05', category: 'fabric', texture: 'mozu_fabric_05', color: '#cdbdae' },
  { id: 'mozu_fabric_06', name: 'Fabric 06', category: 'fabric', texture: 'mozu_fabric_06', color: '#e8ddcd' },
  { id: 'mozu_real_01', name: 'Real 01', category: 'real', texture: 'mozu_real_01', color: '#c6a06a' },
  { id: 'mozu_real_02', name: 'Real 02', category: 'real', texture: 'mozu_real_02', color: '#866646' },
  { id: 'mozu_real_03', name: 'Real 03', category: 'real', texture: 'mozu_real_03', color: '#926f55' },
  { id: 'mozu_real_04', name: 'Real 04', category: 'real', texture: 'mozu_real_04', color: '#4d3e2b' },
];

/** `SwatchCatalog.swatches` — built-ins first, then the imported collections. */
export const SWATCHES: Swatch[] = [...BUILT_IN, ...MOZU_SWATCHES];

export const swatchById = (id: string): Swatch | undefined =>
  SWATCHES.find((s) => s.id === id);

export const swatchesIn = (category: SwatchCategory): Swatch[] =>
  SWATCHES.filter((s) => s.category === category);

export const materialKind = (id: MaterialKind) =>
  MATERIAL_KINDS.find((k) => k.id === id) ?? MATERIAL_KINDS[0];

/**
 * Where the browser can fetch a swatch's bitmap. `scripts/sync-textures.mjs`
 * encodes these out of the iOS bundle as WebP, so the URL exists iff the iPad
 * has the PNG.
 */
export const swatchTextureUrl = (swatch: Swatch | undefined): string | null =>
  swatch?.texture ? `/textures/${swatch.texture}.webp` : null;

/**
 * How much real-world surface one texture tile covers, in METRES.
 *
 * `Room3DBuilder` writes wall and floor UVs in metres and leaves the sampler at
 * its default, so one tile is one metre square there. Matching that here is why
 * a 4 m wall shows four planks across in both renderers rather than one smeared
 * one. `textureScale` multiplies the repeat, which is what the slider means.
 */
export const TEXTURE_TILE_M = 1;

export const DEFAULT_FINISH: SurfaceFinish = {
  swatchId: 'plaster',
  kind: 'matte',
  textureScale: 1,
  rotation: 0,
};

/**
 * The iPad's opening palette for a scanned room (`DesignRoom.init`): soft matte
 * plaster walls, a real light-oak floor, a plaster ceiling. This is the single
 * biggest reason an iPad room reads as somewhere you could stand and the web
 * room read as a grey box — the web had no room finishes at all.
 */
export const DEFAULT_WALL_FINISH: SurfaceFinish = { swatchId: 'plaster', kind: 'matte', textureScale: 1, rotation: 0 };
export const DEFAULT_FLOOR_FINISH: SurfaceFinish = { swatchId: 'oak', kind: 'matte', textureScale: 1, rotation: 0 };
export const DEFAULT_CEILING_FINISH: SurfaceFinish = { swatchId: 'plaster', kind: 'matte', textureScale: 1, rotation: 0 };

/** Painted trim (jambs, heads, sills, baseboards) — `Room3DBuilder.trimMaterial`. */
export const TRIM_COLOR = '#f2f0ec';

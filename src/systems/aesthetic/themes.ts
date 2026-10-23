import type { AestheticTheme } from './types';

/**
 * The curated theme library. Each theme references material ids that exist in
 * the catalog (see `systems/catalog/data.ts`) and respects each material's
 * allowed roles, so a theme always produces a valid, priceable configuration.
 *
 * Japandi is the worked example from the brief; the rest give the recommender
 * something to range over. In production this hydrates from the brand's curated
 * library (Mozu's exclusive Layer-3 content — see `systems/tenant`).
 */
export const THEMES: AestheticTheme[] = [
  {
    id: 'japandi',
    name: 'Japandi',
    keywords: ['japandi', 'japanese scandinavian', 'warm minimal', 'zen', 'muji', 'wabi sabi', 'natural minimal'],
    description: 'Warm woods, clay-soft surfaces and stone — Japanese restraint meets Scandinavian comfort.',
    mood: 'Warm minimal',
    accent: '#B89B72',
    palette: {
      carcass: ['clay-plaster', 'oak'],
      front: ['bamboo', 'clay-plaster', 'oak'],
      worktop: ['travertine', 'quartz-white'],
      handle: ['blackened-brass'],
      panel: ['clay-plaster', 'bamboo'],
      plinth: ['clay-plaster'],
    },
    defaults: {
      carcass: 'clay-plaster',
      front: 'bamboo',
      worktop: 'travertine',
      handle: 'blackened-brass',
      panel: 'clay-plaster',
      plinth: 'clay-plaster',
    },
  },
  {
    id: 'modern-matte',
    name: 'Modern Matte',
    keywords: ['modern', 'matte', 'minimal', 'contemporary', 'handleless', 'clean'],
    description: 'Handleless matte fronts with quartz tops — crisp and contemporary.',
    mood: 'Crisp & handleless',
    accent: '#3A3A3D',
    palette: {
      carcass: ['matte-white', 'oak'],
      front: ['matte-white', 'graphite'],
      worktop: ['quartz-white', 'granite-black'],
      handle: ['brushed-steel'],
      panel: ['matte-white', 'graphite'],
      plinth: ['matte-white', 'graphite'],
    },
    defaults: {
      carcass: 'matte-white',
      front: 'matte-white',
      worktop: 'quartz-white',
      handle: 'brushed-steel',
      panel: 'matte-white',
      plinth: 'matte-white',
    },
  },
  {
    id: 'nordic-oak',
    name: 'Nordic Oak',
    keywords: ['scandi', 'scandinavian', 'nordic', 'oak', 'light wood', 'airy', 'warm'],
    description: 'Light oak fronts, airy and natural — the Scandinavian classic.',
    mood: 'Light & natural',
    accent: '#C8A165',
    palette: {
      carcass: ['oak', 'matte-white'],
      front: ['oak', 'matte-white'],
      worktop: ['quartz-white', 'travertine'],
      handle: ['brushed-steel', 'blackened-brass'],
      panel: ['oak', 'matte-white'],
      plinth: ['matte-white'],
    },
    defaults: {
      carcass: 'oak',
      front: 'oak',
      worktop: 'quartz-white',
      handle: 'brushed-steel',
      panel: 'oak',
      plinth: 'matte-white',
    },
  },
  {
    id: 'industrial-loft',
    name: 'Industrial Loft',
    keywords: ['industrial', 'loft', 'dark', 'moody', 'urban', 'black', 'raw'],
    description: 'Graphite and charcoal with black granite and blackened brass — dark and raw.',
    mood: 'Dark & raw',
    accent: '#1C1C1E',
    palette: {
      carcass: ['matte-white'],
      front: ['graphite', 'charcoal-ash'],
      worktop: ['granite-black', 'travertine'],
      handle: ['blackened-brass', 'brushed-steel'],
      panel: ['graphite', 'charcoal-ash'],
      plinth: ['graphite'],
    },
    defaults: {
      carcass: 'matte-white',
      front: 'graphite',
      worktop: 'granite-black',
      handle: 'blackened-brass',
      panel: 'graphite',
      plinth: 'graphite',
    },
  },
  {
    id: 'classic-walnut',
    name: 'Classic Walnut',
    keywords: ['classic', 'walnut', 'warm dark', 'traditional', 'rich', 'timeless'],
    description: 'Rich walnut fronts with black granite — warm, timeless, considered.',
    mood: 'Rich & timeless',
    accent: '#5B3A24',
    palette: {
      carcass: ['matte-white'],
      front: ['walnut', 'graphite'],
      worktop: ['granite-black', 'travertine'],
      handle: ['blackened-brass', 'brushed-steel'],
      panel: ['walnut', 'graphite'],
      plinth: ['graphite'],
    },
    defaults: {
      carcass: 'matte-white',
      front: 'walnut',
      worktop: 'granite-black',
      handle: 'blackened-brass',
      panel: 'walnut',
      plinth: 'graphite',
    },
  },
];

export const THEMES_BY_ID: Record<string, AestheticTheme> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
);

export const DEFAULT_THEME_ID = 'japandi';

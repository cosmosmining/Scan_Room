import type { Room } from '@/lib/types';
import type { LayoutObstacle, LayoutRequest, LayoutResult } from '@/systems/layout';

/**
 * AI-driven design system (Phase 2 of the MOZU pipeline): turn a captured room
 * boundary into a functional, ready-to-use layout the user can then modify.
 *
 * The reference app surfaces this as "Kitchen Sets" with a RECOMMENDED badge and
 * a "Need advice" button: pre-composed sets (single-wall, galley, L, U) ranked
 * by how well they fit the scanned space. This module produces exactly that —
 * deterministically, from the room geometry and the live catalog.
 */

export type DesignDomain = 'kitchen' | 'wardrobe';

/** The canonical run configurations the planner recognises (see layout README). */
export type LayoutShape = 'single-wall' | 'galley' | 'l-shaped' | 'u-shaped';

/** What the user is asking for — mirrors the app's free-text "Need advice". */
export interface DesignIntent {
  domain: DesignDomain;
  /** Optional natural-language brief, e.g. "lots of drawers, no tall units". */
  brief?: string;
  /** Columns the scan found; the plans are packed clear of them. */
  obstacles?: LayoutObstacle[];
}

/** A wall the planner can pack along, with its post-reserve usable length. */
export interface PlannableRun {
  wallId: string;
  /** Raw wall length, mm. */
  length: number;
  /** Usable length after corner reserve / wall gap, mm. */
  usableLength: number;
  /** True when the run starts at an inside corner (shares a wall endpoint). */
  startsAtCorner: boolean;
}

/** One placed module in a recommendation — directly applyable via `addModule`. */
export interface PlannedModule {
  definitionId: string;
  wallId: string;
  width: number;
}

/**
 * One AI-proposed layout the user can accept — a "kitchen set" card. Carries the
 * engine-ready request, the pre-computed result (so the UI can preview fit and
 * violations without re-running), a plain-language rationale, and the ordered
 * module list to rebuild it in the configurator's module tree.
 */
export interface LayoutRecommendation {
  id: string;
  name: string;
  shape: LayoutShape;
  /** 0..1 fit score; the highest-scoring recommendation is flagged. */
  score: number;
  recommended: boolean;
  /** Human-readable "why" shown under the card. */
  rationale: string;
  request: LayoutRequest;
  result: LayoutResult;
  modules: PlannedModule[];
}

/** A baseline solution: the instant, functional starting point for the space. */
export interface BaselineLayout {
  recommendation: LayoutRecommendation;
  /** Plain-language summary of what the AI placed and why. */
  summary: string;
}

/**
 * @mozu/scan-sdk — phone scanning → floorplan, framework-agnostic.
 *
 * The web app, the Chrome/Safari extensions, and (via the shared JSON contract)
 * the iOS RoomPlan app all build on these primitives:
 *
 *   const scanner = new MozuScanner({ webBase: 'https://app.mozu.example' });
 *   const scan = await scanner.scanWithAR();        // metric corner tap (Android)
 *   const plan = scanner.floorplan(scan);           // dimensioned floorplan
 *   const svg  = scanner.toSvg(plan, { theme: 'light' });
 *   location.href = scanner.handoff(scan);          // open MOZU on this room
 */
export * from './types';
export * from './geometry';
export * from './format';
export * from './fixtures';
export * from './floorplan';
export * from './massing';
export * from './svg';
export * from './serialize';
export * from './webxr';
export * from './camera';
export * from './scanner';

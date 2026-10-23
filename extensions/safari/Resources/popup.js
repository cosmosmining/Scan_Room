/**
 * Popup launcher: shows the device's best capture path, opens the full scanner
 * page, persists the MOZU host, and previews a quick manual floorplan that can
 * be opened straight in MOZU. Heavy capture lives in scanner.js.
 */
import {
  MozuScanner,
  buildFloorplan,
  floorplanToSvg,
  rectangleScan,
} from './vendor/mozu-scan-sdk.js';

const DEFAULT_BASE = 'https://app.mozu.example';
const $ = (id) => document.getElementById(id);

// Chrome and Safari both expose the WebExtension API as `chrome`/`browser`.
const ext = globalThis.browser ?? globalThis.chrome;
const store = {
  async get() {
    const v = await ext.storage.sync.get({ mozuBase: DEFAULT_BASE });
    return v.mozuBase || DEFAULT_BASE;
  },
  set(mozuBase) {
    return ext.storage.sync.set({ mozuBase });
  },
};

async function init() {
  const base = await store.get();
  $('base').value = base;

  const cap = await new MozuScanner().capability();
  $('cap').textContent =
    cap === 'webxr' ? 'AR scan available' : cap === 'camera' ? 'Camera available' : 'Manual / trace';

  const renderThumb = () => {
    const scan = rectangleScan(num('w'), num('d'), num('h'), 'metric', 'manual');
    $('thumb').innerHTML = floorplanToSvg(buildFloorplan(scan), { theme: 'light' });
  };
  ['w', 'd', 'h'].forEach((id) => $(id).addEventListener('input', renderThumb));
  renderThumb();

  $('base').addEventListener('change', () => store.set($('base').value.trim()));

  $('open-scanner').addEventListener('click', () => {
    ext.tabs.create({ url: ext.runtime.getURL('scanner.html') });
    window.close();
  });

  $('open-mozu').addEventListener('click', async () => {
    const scanner = new MozuScanner({ webBase: (await store.get()).replace(/\/+$/, '') });
    const scan = rectangleScan(num('w'), num('d'), num('h'), 'metric', 'manual');
    ext.tabs.create({ url: scanner.handoff(scan) });
    window.close();
  });
}

const num = (id) => Number($(id).value) || 0;

init();

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// The handoff, end to end: a scan as the iPad sends it → a six-character code
// → the room on the web, and the edits people make to it there.
//
// The scan is fixtures/scans/synthetic-l-room.scan.json: an L-shaped room
// with a window, a suggested glass door, a door, a round column and a sofa.
// ---------------------------------------------------------------------------

// Resolved from the repo root, where Playwright runs.
const SCAN = readFileSync(resolve('fixtures/scans/synthetic-l-room.scan.json'), 'utf8');

/** Room millimetres → a point on screen, via the plan's own SVG transform. */
async function at(page: Page, x: number, z: number) {
  return page.evaluate(([x, z]) => {
    const svg = [...document.querySelectorAll('svg')].find((s) => s.getAttribute('viewBox') && s.getScreenCTM())!;
    const p = svg.createSVGPoint();
    p.x = x; p.y = z;
    const q = p.matrixTransform(svg.getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [x, z] as const);
}

async function openScan(page: Page) {
  const res = await page.request.post('/api/scan-handoff', { data: JSON.parse(SCAN) });
  expect(res.status()).toBe(201);
  const { code, url } = await res.json();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await page.goto(url);
  await expect(page.getByText('Floorplan · auto-measured')).toBeVisible();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(500);
}

const sizeField = (page: Page, label: string) =>
  page.locator('label').filter({ hasText: new RegExp(`^${label}\\s*mm$`) }).locator('input');

test.describe('scan handoff', () => {
  test('a code opens the scanned room, with its openings, column and furniture', async ({ page }) => {
    await openScan(page);
    await expect(page.getByText('22.5 m²')).toBeVisible();
    await expect(page.locator('circle[fill="#5b5b64"]')).toHaveCount(1); // the round column
    await expect(page.locator('text').filter({ hasText: /^sofa$/ })).toHaveCount(1);
  });

  test('an unknown code says so instead of opening an empty room', async ({ page }) => {
    const res = await page.request.get('/api/scan-handoff?code=ZZZZZZ');
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('a suggested glass door can be reviewed, resized by typing, kept', async ({ page }) => {
    await openScan(page);
    const p = await at(page, 6000, 1250);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByText('Seen through during the scan')).toBeVisible();

    const width = sizeField(page, 'Width');
    await width.fill('');
    await width.pressSequentially('1200');
    await width.press('Enter');
    await expect(width).toHaveValue('1200');

    // Larger than the wall: held to the wall.
    await width.fill('99999');
    await width.press('Enter');
    await expect(width).toHaveValue('2500');

    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByText('Seen through during the scan')).toBeHidden();
  });

  test('picking furniture drops the door inspector, so Remove cannot hit the door', async ({ page }) => {
    await openScan(page);
    let p = await at(page, 6000, 1250);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByText('Seen through during the scan')).toBeVisible();
    p = await at(page, 4200, 1300);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByText('Seen through during the scan')).toBeHidden();
    await expect(page.getByText('sofa · drag to move')).toBeVisible();
  });

  test('furniture drags; the column does not', async ({ page }) => {
    await openScan(page);
    const sofaX = () => page.locator('text').filter({ hasText: /^sofa$/ }).getAttribute('x');
    const before = Number(await sofaX());
    let a = await at(page, 4200, 1300), b = await at(page, 4600, 1700);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    expect(Number(await sofaX()) - before).toBeCloseTo(400, -1);

    const column = page.locator('circle[fill="#5b5b64"]');
    const cx = await column.getAttribute('cx');
    a = await at(page, 1500, 1500); b = await at(page, 2500, 2000);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    await expect(column).toHaveAttribute('cx', cx!);
    await expect(page.getByText('Column · part of the structure')).toBeVisible();
  });

  test('tapping a bare wall adds a window with its inspector open', async ({ page }) => {
    await openScan(page);
    await page.getByRole('button', { name: 'window', exact: true }).click();
    const p = await at(page, 0, 4000);
    await page.mouse.click(p.x, p.y);
    await expect(sizeField(page, 'Sill')).toHaveValue('900');
  });

  test('changing only the ceiling height keeps the scanned room and what is in it', async ({ page }) => {
    await openScan(page);
    await page.getByLabel(/Height/).first().fill('2800');
    await page.getByRole('button', { name: 'Apply dimensions' }).click();
    await expect(page.getByText('22.5 m²')).toBeVisible();
    await expect(page.locator('circle[fill="#5b5b64"]')).toHaveCount(1);
    await expect(page.locator('text').filter({ hasText: /^sofa$/ })).toHaveCount(1);
  });

  test('the 3D view renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openScan(page);
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForTimeout(3000);
    await expect(page.locator('canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

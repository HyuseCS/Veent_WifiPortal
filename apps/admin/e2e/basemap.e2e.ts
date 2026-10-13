import { test, expect, type Page } from '@playwright/test';

const STYLE_STUB = JSON.stringify({
	version: 8,
	sources: {},
	layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ccc' } }]
});

async function stubProviders(page: Page) {
	const basemap: string[] = [];
	const carto: string[] = [];
	await page.addInitScript(() => {
		localStorage['radius-admin-theme'] = 'light';
	});
	await page.route('https://tiles.openfreemap.org/**', (route) => {
		basemap.push(route.request().url());
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'access-control-allow-origin': '*' },
			body: STYLE_STUB
		});
	});
	await page.route(/cartocdn\.com/, (route) => {
		carto.push(route.request().url());
		return route.abort();
	});
	return { basemap, carto };
}

const canvas = '.leaflet-tile-pane .maplibregl-canvas';

async function zIndex(page: Page, selector: string) {
	return page.locator(selector).evaluate((el) => Number(getComputedStyle(el).zIndex));
}

for (const path of ['/networks', '/map']) {
	test(`${path} shows the OpenFreeMap basemap and switches theme live`, async ({ page }) => {
		const { basemap, carto } = await stubProviders(page);
		await page.goto(path);
		if (path === '/networks') {
			await expect(page.getByText('OAP3000G-C')).toBeVisible({ timeout: 30_000 });
		}

		await expect(page.locator(canvas)).toHaveCount(1);
		expect(basemap.some((u) => u.endsWith('/styles/positron'))).toBe(true);

		await expect(page.locator('.leaflet-marker-pane .vpin').first()).toBeAttached();
		const tile = await zIndex(page, '.leaflet-tile-pane');
		expect(tile).toBeLessThan(await zIndex(page, '.leaflet-marker-pane'));
		if (path === '/map') {
			expect(tile).toBeLessThan(await zIndex(page, '.leaflet-domes-pane'));
		}

		const attribution = page.locator('.leaflet-control-attribution');
		await expect(attribution).toContainText('OpenFreeMap');
		await expect(attribution).toContainText('OpenMapTiles');
		await expect(attribution).toContainText('OpenStreetMap');
		await expect(attribution).not.toContainText('CARTO');

		const pins = await page.locator('.vpin').count();
		const transform = await page
			.locator('.leaflet-map-pane')
			.evaluate((el) => (el as HTMLElement).style.transform);
		await page.evaluate(() => {
			(window as unknown as { __noReload: boolean }).__noReload = true;
			document.documentElement.dataset.theme = 'dark';
		});
		await expect
			.poll(() => basemap.some((u) => u.endsWith('/styles/dark')), { timeout: 2000 })
			.toBe(true);
		expect(
			await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)
		).toBe(true);
		expect(await page.locator('.vpin').count()).toBe(pins);
		expect(
			await page.locator('.leaflet-map-pane').evaluate((el) => (el as HTMLElement).style.transform)
		).toBe(transform);
		await expect(page.locator(canvas)).toHaveCount(1);

		expect(carto).toEqual([]);
	});
}

test('/map double-click on the basemap still drops a pin', async ({ page }) => {
	await stubProviders(page);
	await page.goto('/map');
	await expect(page.locator(canvas)).toHaveCount(1);

	const box = await page.locator('.leaflet-container').first().boundingBox();
	if (!box) throw new Error('map container has no box');
	await page.mouse.dblclick(box.x + box.width * 0.85, box.y + box.height * 0.3);

	const lat = page.locator('input[name="latitude"]');
	const lng = page.locator('input[name="longitude"]');
	await expect(lat).toHaveCount(1);
	expect(Number(await lat.inputValue())).not.toBeNaN();
	expect(Number(await lng.inputValue())).not.toBeNaN();
	expect(await lat.inputValue()).not.toBe('');
});

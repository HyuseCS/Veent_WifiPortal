import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyMap } from './mapProxy';

const UP = 'https://tiles.openfreemap.org/';
const HOST = 'http://10.210.54.133:3003';
const DAY = 'public, max-age=86400';
const LONG = 'public, max-age=31536000, immutable';

type Handler = (path: string) => Response | Promise<Response>;

function stub(handler: Handler = (p) => defaultResponse(p)) {
	const fn = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async (input) =>
		handler(String(input).slice(UP.length))
	);
	vi.stubGlobal('fetch', fn);
	return fn;
}

function json(body: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(body), init);
}

function defaultResponse(path: string) {
	if (path.startsWith('styles/')) return json({ version: 8, sources: {} });
	if (path === 'planet') return json({ tiles: [`${UP}planet/20261004_113936_pt/{z}/{x}/{y}.pbf`] });
	if (path.endsWith('.json')) return json({});
	return new Response(new Uint8Array([1, 2, 3]));
}

function call(path: string, headers: Record<string, string> = {}, base = 'http://localhost:5172') {
	return proxyMap(new URL(`${base}/map/${path}`), new Request(`${base}/map/${path}`, { headers }));
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('accepted paths', () => {
	it.each([
		'styles/positron',
		'styles/dark',
		'planet',
		'planet/20261004_113936_pt/14/13684/7581.pbf',
		'natural_earth/ne2sr/3/6/3.png',
		'fonts/Noto%20Sans%20Regular/0-255.pbf',
		'fonts/Noto%20Sans%20Bold/256-511.pbf',
		'sprites/ofm_f384/ofm.json',
		'sprites/ofm_f384/ofm@2x.png'
	])('%s gives 200 and one upstream fetch', async (path) => {
		const fetchMock = stub();
		const res = await call(path);
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toBe(UP + path);
	});
});

describe('refused paths', () => {
	it.each([
		'',
		'etc/passwd',
		'styles/liberty',
		'styles/positron/x',
		'..%2Fstyles/positron',
		'planet%2F..%2Fstyles/positron',
		'fonts/..%2F..%2Fx/0-255.pbf',
		'fonts/a/b/0-255.pbf',
		'planet/latest/1/2/3.pbf',
		'sprites/ofm_f384%2F..%2Fx.json',
		'https:/example.com/x'
	])('%j gives 404 and no fetch', async (path) => {
		const fetchMock = stub();
		const res = await call(path);
		expect(res.status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('query', () => {
	it('is dropped', async () => {
		const fetchMock = stub();
		await call('styles/positron?u=https://example.com');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toBe(`${UP}styles/positron`);
	});
});

describe('route module', () => {
	it('exports only GET', async () => {
		const mod = await import('../../routes/map/[...path]/+server');
		expect(Object.keys(mod)).toEqual(['GET']);
	});
});

describe('rewrite', () => {
	const style = {
		version: 8,
		sprite: `${UP}sprites/ofm_f384/ofm`,
		glyphs: `${UP}fonts/{fontstack}/{range}.pbf`,
		sources: {
			openmaptiles: { type: 'vector', url: `${UP}planet` },
			ne2_shaded: {
				type: 'raster',
				tiles: [`${UP}natural_earth/ne2sr/{z}/{x}/{y}.png`],
				tileSize: 256
			}
		},
		layers: []
	};

	it('rewrites style fields to the Host origin', async () => {
		stub(() => json(style));
		const res = await call('styles/positron', { host: '10.210.54.133:3003' });
		const body = await res.json();
		expect(body.sprite).toBe(`${HOST}/map/sprites/ofm_f384/ofm`);
		expect(body.glyphs).toBe(`${HOST}/map/fonts/{fontstack}/{range}.pbf`);
		expect(body.sources.openmaptiles.url).toBe(`${HOST}/map/planet`);
		expect(body.sources.ne2_shaded.tiles[0]).toBe(
			`${HOST}/map/natural_earth/ne2sr/{z}/{x}/{y}.png`
		);
	});

	it('rewrites a sprite array', async () => {
		stub(() => json({ ...style, sprite: [{ id: 'default', url: `${UP}sprites/ofm_f384/ofm` }] }));
		const res = await call('styles/positron', { host: '10.210.54.133:3003' });
		const body = await res.json();
		expect(body.sprite).toEqual([{ id: 'default', url: `${HOST}/map/sprites/ofm_f384/ofm` }]);
	});

	it('rewrites TileJSON tiles and keeps attribution', async () => {
		const attribution =
			'<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright">OSM</a>';
		stub(() => json({ tiles: [`${UP}planet/20261004_113936_pt/{z}/{x}/{y}.pbf`], attribution }));
		const res = await call('planet', { host: '10.210.54.133:3003' });
		const body = await res.json();
		expect(body.tiles[0]).toBe(`${HOST}/map/planet/20261004_113936_pt/{z}/{x}/{y}.pbf`);
		expect(body.attribution).toBe(attribution);
	});

	it('rewrites a provider GeoJSON data URL', async () => {
		stub(() => json({ ...style, sources: { g: { type: 'geojson', data: `${UP}x.geojson` } } }));
		const res = await call('styles/positron', { host: '10.210.54.133:3003' });
		const body = await res.json();
		expect(body.sources.g.data).toBe(`${HOST}/map/x.geojson`);
	});
});

describe('origin', () => {
	const tj = { tiles: [`${UP}planet/20261004_113936_pt/{z}/{x}/{y}.pbf`] };

	it('uses https when x-forwarded-proto is https', async () => {
		stub(() => json(tj));
		const res = await call('planet', { host: '10.210.54.133:3003', 'x-forwarded-proto': 'https' });
		expect((await res.json()).tiles[0]).toMatch(/^https:\/\/10\.210\.54\.133:3003\/map\//);
	});

	it.each(['evil.com/x', 'a"b', 'x@y'])(
		'falls back to the URL origin for host %j',
		async (host) => {
			stub(() => json(tj));
			const res = await call('planet', { host });
			expect((await res.json()).tiles[0]).toMatch(/^http:\/\/localhost:5172\/map\//);
		}
	);
});

describe('foreign hosts', () => {
	const style = { version: 8, sources: {} as Record<string, unknown> };
	it.each([
		[
			'glyphs',
			{ ...style, glyphs: 'https://other.example/{fontstack}/{range}.pbf' },
			'styles/positron'
		],
		[
			'url suffix attack',
			{
				...style,
				sources: { a: { type: 'vector', url: 'https://tiles.openfreemap.org.evil.com/planet' } }
			},
			'styles/positron'
		],
		['tilejson tiles', { tiles: ['https://other.example/{z}/{x}/{y}.pbf'] }, 'planet'],
		[
			'geojson data',
			{ ...style, sources: { g: { type: 'geojson', data: 'https://other.example/a.geojson' } } },
			'styles/positron'
		],
		[
			'video urls',
			{ ...style, sources: { v: { type: 'video', urls: ['//other.example/v.mp4'] } } },
			'styles/positron'
		]
	])('%s gives 502', async (_n, body, path) => {
		stub(() => json(body));
		const res = await call(path);
		expect(res.status).toBe(502);
	});

	it('invalid JSON gives 502', async () => {
		stub(() => new Response('not json'));
		expect((await call('styles/positron')).status).toBe(502);
	});
});

describe('outbound request', () => {
	it('sends only accept and refuses redirects', async () => {
		const fetchMock = stub();
		await call('styles/positron', {
			cookie: 'a=b',
			referer: 'http://x/',
			'x-forwarded-for': '1.2.3.4',
			'x-real-ip': '1.2.3.4',
			forwarded: 'for=1.2.3.4',
			'cf-connecting-ip': '1.2.3.4',
			'user-agent': 'ua',
			authorization: 'Bearer t'
		});
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.headers).toEqual({ accept: '*/*' });
		expect(init.redirect).toBe('error');
	});
});

describe('response headers', () => {
	const hostile = {
		'content-type': 'text/html',
		'content-encoding': 'gzip',
		'content-length': '3',
		'set-cookie': 'a=b',
		etag: '"x"'
	};

	it.each([
		['styles/positron', DAY, 'application/json'],
		['planet', DAY, 'application/json'],
		['planet/20261004_113936_pt/14/13684/7581.pbf', LONG, 'application/x-protobuf'],
		['natural_earth/ne2sr/3/6/3.png', LONG, 'image/png'],
		['fonts/Noto%20Sans%20Bold/256-511.pbf', LONG, 'application/x-protobuf'],
		['sprites/ofm_f384/ofm.json', LONG, 'application/json'],
		['sprites/ofm_f384/ofm@2x.png', LONG, 'image/png']
	])('%s', async (path, cache, type) => {
		stub((p) => {
			const base = defaultResponse(p);
			return new Response(base.body, { headers: hostile });
		});
		const res = await call(path);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe(cache);
		expect(res.headers.get('content-type')).toBe(type);
		for (const h of ['content-encoding', 'set-cookie', 'etag']) {
			expect(res.headers.get(h)).toBeNull();
		}
		expect(res.headers.get('content-length')).not.toBe('3');
	});
});

describe('errors', () => {
	it('uses a timeout of 10 s or less on the fetch signal', async () => {
		const spy = vi.spyOn(AbortSignal, 'timeout');
		const fetchMock = stub();
		await call('styles/positron');
		expect(spy).toHaveBeenCalled();
		expect(spy.mock.calls[0][0]).toBeLessThanOrEqual(10000);
		expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(spy.mock.results[0].value);
	});

	it.each([
		['timeout', () => Promise.reject(new DOMException('x', 'TimeoutError')), 504],
		['network', () => Promise.reject(new TypeError('x')), 502],
		['upstream 404', () => new Response('', { status: 404 }), 404],
		['upstream 500', () => new Response('', { status: 500 }), 502]
	] as [string, Handler, number][])('%s gives %i with no-store', async (_n, handler, status) => {
		stub(handler);
		const res = await call('styles/positron');
		expect(res.status).toBe(status);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});
});

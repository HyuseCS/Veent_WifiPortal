const UPSTREAM = 'https://tiles.openfreemap.org/';
const DAY = 'public, max-age=86400';
const LONG = 'public, max-age=31536000, immutable';
const JSON_TYPE = 'application/json';
const PBF = 'application/x-protobuf';
const PNG = 'image/png';

const RULES: { pattern: RegExp; type: string; cache: string; rewrite: boolean }[] = [
	{ pattern: /^styles\/(?:positron|dark)$/, type: JSON_TYPE, cache: DAY, rewrite: true },
	{ pattern: /^planet$/, type: JSON_TYPE, cache: DAY, rewrite: true },
	{
		pattern: /^planet\/\d{8}_\d{6}_[a-z]+\/\d{1,2}\/\d{1,5}\/\d{1,5}\.pbf$/,
		type: PBF,
		cache: LONG,
		rewrite: false
	},
	{
		pattern: /^natural_earth\/ne2sr\/\d{1,2}\/\d{1,5}\/\d{1,5}\.png$/,
		type: PNG,
		cache: LONG,
		rewrite: false
	},
	{
		pattern: /^fonts\/(?:[\w,-]|%20)+\/\d{1,5}-\d{1,5}\.pbf$/,
		type: PBF,
		cache: LONG,
		rewrite: false
	},
	{
		pattern: /^sprites\/ofm_[a-z0-9]+\/ofm(?:@2x)?\.json$/,
		type: JSON_TYPE,
		cache: LONG,
		rewrite: false
	},
	{ pattern: /^sprites\/ofm_[a-z0-9]+\/ofm(?:@2x)?\.png$/, type: PNG, cache: LONG, rewrite: false }
];

const HOST = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$/;
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function requestOrigin(url: URL, request: Request): string {
	const host = request.headers.get('host');
	if (!host || !HOST.test(host)) return url.origin;
	return `${request.headers.get('x-forwarded-proto') === 'https' ? 'https' : 'http'}://${host}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rewrite(doc: unknown, origin: string): unknown {
	const local = (v: unknown) => {
		if (typeof v !== 'string' || !v.startsWith(UPSTREAM)) throw new Error('foreign map URL');
		return `${origin}/map/${v.slice(UPSTREAM.length)}`;
	};
	const list = (v: unknown) => {
		if (!Array.isArray(v)) throw new Error('map URL list is not an array');
		return v.map(local);
	};
	const absolute = (v: unknown) => (typeof v === 'string' && ABSOLUTE.test(v) ? local(v) : v);

	if (!isObject(doc)) throw new Error('map JSON is not an object');
	if ('sprite' in doc) {
		doc.sprite = Array.isArray(doc.sprite)
			? doc.sprite.map((s) => {
					if (!isObject(s)) throw new Error('sprite entry is not an object');
					return { ...s, url: local(s.url) };
				})
			: local(doc.sprite);
	}
	if ('glyphs' in doc) doc.glyphs = local(doc.glyphs);
	if ('tiles' in doc) doc.tiles = list(doc.tiles);
	if ('sources' in doc) {
		if (!isObject(doc.sources)) throw new Error('sources is not an object');
		for (const src of Object.values(doc.sources)) {
			if (!isObject(src)) throw new Error('source is not an object');
			for (const [k, v] of Object.entries(src)) {
				if (k === 'url') src.url = local(v);
				else if (k === 'tiles') src.tiles = list(v);
				else src[k] = Array.isArray(v) ? v.map(absolute) : absolute(v);
			}
		}
	}
	return doc;
}

function fail(status: number): Response {
	return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

export async function proxyMap(url: URL, request: Request): Promise<Response> {
	const path = url.pathname.slice('/map/'.length);
	const rule = RULES.find((r) => r.pattern.test(path));
	if (!rule) return new Response(null, { status: 404 });

	try {
		const res = await fetch(UPSTREAM + path, {
			headers: { accept: '*/*' },
			redirect: 'error',
			signal: AbortSignal.timeout(8000)
		});
		if (res.status === 404) return fail(404);
		if (!res.ok) return fail(502);
		// ponytail: buffered, uncompressed body (research R7); stream upstream bytes with their encoding if SC-004 misses
		const body = rule.rewrite
			? JSON.stringify(rewrite(JSON.parse(await res.text()), requestOrigin(url, request)))
			: await res.arrayBuffer();
		return new Response(body, {
			headers: { 'content-type': rule.type, 'cache-control': rule.cache }
		});
	} catch (e) {
		return fail((e as Error)?.name === 'TimeoutError' ? 504 : 502);
	}
}

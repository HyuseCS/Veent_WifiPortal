/**
 * k6 stress test — N guests hitting /api/network/grant at once (real MikroTik path).
 *
 *   k6 run -e BASE_URL=http://<laptop-host> apps/customer/loadtest/grant-spike.js
 *   k6 run -e BASE_URL=http://10.210.0.9 -e VUS=100 apps/customer/loadtest/grant-spike.js
 *
 * Each virtual user replays one seeded session cookie (from sessions.json) and POSTs a
 * free-time grant for its own unique MAC. With the app configured NETWORK_CONTROLLER=mikrotik,
 * every grant fires a real binding on the router — so this measures the end-to-end limit
 * (SvelteKit + Drizzle pool + node-routeros + the MikroTik API), not just the app.
 *
 * RAMPING SLOWLY: -e VUS=N sets the concurrency; -e START=M offsets into the session pool so
 * each run uses FRESH users (a reused user = free-time cooldown 429 that never reaches the
 * router). Seed a pool big enough for the whole ramp, then advance START by the previous VUS:
 *   COUNT=200 bun run --filter veent-customer loadtest:seed   # once
 *   k6 run -e BASE_URL=… -e VUS=5   -e START=0    grant-spike.js
 *   k6 run -e BASE_URL=… -e VUS=10  -e START=5    grant-spike.js
 *   k6 run -e BASE_URL=… -e VUS=25  -e START=15   grant-spike.js
 *   k6 run -e BASE_URL=… -e VUS=50  -e START=40   grant-spike.js
 *   k6 run -e BASE_URL=… -e VUS=100 -e START=90   grant-spike.js   # needs START+VUS ≤ pool
 *
 * IMPORTANT: run cleanup.ts afterward — every grant leaves a real ip-binding on the router.
 */
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

const sessions = new SharedArray('sessions', () => JSON.parse(open('./sessions.json')));

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const VUS = Number(__ENV.VUS || 100);
const START = Number(__ENV.START || 0); // offset into the pool so each ramp step uses fresh users

const granted = new Counter('grants_ok');
const rejected = new Counter('grants_rejected');

export const options = {
	scenarios: {
		spike: {
			executor: 'per-vu-iterations',
			vus: VUS,
			iterations: 1,
			maxDuration: '120s'
		}
	},
	// Observe first; these flag trouble rather than hard-gating a stress run.
	thresholds: {
		http_req_failed: ['rate<0.05'],
		http_req_duration: ['p(95)<8000']
	}
};

export default function () {
	if (sessions.length === 0) throw new Error('sessions.json is empty — run loadtest:seed first');
	const idx = START + __VU - 1;
	if (idx >= sessions.length) {
		throw new Error(
			`Need session #${idx + 1} but only ${sessions.length} seeded. ` +
				`Raise COUNT in loadtest:seed, or lower START/VUS (START+VUS must be ≤ pool size).`
		);
	}
	const s = sessions[idx];

	const res = http.post(`${BASE_URL}/api/network/grant`, JSON.stringify({ macAddress: s.mac }), {
		headers: { 'Content-Type': 'application/json', Cookie: s.cookie },
		tags: { name: 'grant' }
	});

	const ok = check(res, {
		'status 200': (r) => r.status === 200,
		'granted ok': (r) => {
			try {
				return JSON.parse(r.body).ok === true;
			} catch {
				return false;
			}
		}
	});

	if (ok) granted.add(1);
	else {
		rejected.add(1);
		// Surface the first failures so a misconfig (401 = bad cookie, 429 = cooldown/limit,
		// 500 = router error) is obvious in the console, not just the summary.
		console.error(`VU${__VU} grant ${res.status}: ${String(res.body).slice(0, 160)}`);
	}
}

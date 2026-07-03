import { defineConfig } from 'vitest/config';

// Core is a plain TS package (no Svelte/browser) — a minimal node-environment vitest is enough for
// the service unit tests (outage sweep, observability). vitest transpiles the TS via esbuild.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.{spec,test}.ts']
	}
});

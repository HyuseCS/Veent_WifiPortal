import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sentrySvelteKit } from '@sentry/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';

// Sentry source-map upload — active ONLY when a full build-time upload config is present
// (SENTRY_AUTH_TOKEN + org + project). Without it, the plugin is not added at all, so token-less
// builds (dev, CI, any deploy that hasn't set a releases token) are byte-identical to before: NO
// client source maps are generated, so none can ever be served to browsers. When configured, maps
// are uploaded then deleted (filesToDeleteAfterUpload) so they still never ship. `autoInstrument`
// is off — this does source maps ONLY, it does not wrap load functions (no runtime change). The
// build token is DISTINCT from the runtime dashboard token and needs `project:releases` scope —
// see docs/DEPLOYMENT.md.
const sentryPlugins =
	process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG_SLUG && process.env.SENTRY_PROJECT_ID
		? [
				sentrySvelteKit({
					autoInstrument: false,
					org: process.env.SENTRY_ORG_SLUG,
					project: process.env.SENTRY_PROJECT_ID,
					sourcemaps: {
						filesToDeleteAfterUpload: ['./build/**/*.map', './.svelte-kit/**/*.map']
					}
				})
			]
		: [];

export default defineConfig({
	plugins: [
		...sentryPlugins,
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node: self-hosted Node/Bun server. `bun run build` emits
			// build/index.js — start it with `node build` (or `bun ./build`).
			adapter: adapter()
		})
	],

	// @veent/db and @veent/core ship TypeScript source from the workspace; Vite
	// externalizes dependencies for SSR by default, so opt them in for transpilation.
	ssr: { noExternal: ['@veent/db', '@veent/core'] },

	// Dev only: allow the dev server to be reached via a tunnel host (cloudflared
	// / ngrok) for on-device captive-portal testing. Has no effect on the build.
	server: { allowedHosts: true },

	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});

<script lang="ts">
	import Icon from '$lib/Icon.svelte';

	type Social = { name: string; href: string; icon: 'facebook' | 'instagram' | 'globe' | 'mail' };

	// Parafiber's public channels — where guests find promos & updates. HARDCODED by design
	// (they rarely change): just edit the URLs here. Leave an href empty to hide that one; the
	// whole strip hides when none are set.
	const ALL: Social[] = [
		{
			name: 'Facebook — Parafiber',
			href: 'https://www.facebook.com/parafiberbyparasatHD/',
			icon: 'facebook'
		},
		{ name: 'Facebook — Parasat', href: 'https://www.facebook.com/ParasatHD', icon: 'facebook' },
		{ name: 'Website', href: 'https://www.parasat.tv/', icon: 'globe' },
		{ name: 'Email', href: 'mailto:parasat.web@websprinter.net', icon: 'mail' }
	];
	const SOCIALS = ALL.filter((s) => s.href);
</script>

{#if SOCIALS.length}
	<footer class="flex flex-col items-center gap-2.5 px-5 py-6 text-center">
		<p class="text-[12.5px] font-medium text-muted">
			Stay connected with Parafiber — promos, updates &amp; support
		</p>
		<div class="flex items-center gap-2.5">
			{#each SOCIALS as s (s.name)}
				<a
					href={s.href}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={s.name}
					title={s.name}
					class="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:cursor-pointer hover:bg-brand-tint-2 hover:text-brand"
				>
					<Icon name={s.icon} size={17} />
				</a>
			{/each}
		</div>
	</footer>
{/if}

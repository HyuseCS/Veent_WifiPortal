<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '$lib/Icon.svelte';
	import logo from '$lib/assets/parafiber-logo.webp';

	// `thisOnline` reflects THIS device (account time alone isn't "online" if this device
	// isn't actually bound). The Sign out control is a <label for="signout-confirm"> that
	// toggles the CSS-only dialog owned by the page — the checkbox lives in the page, not here.
	let {
		thisOnline,
		balance,
		points,
		maskedPhone
	}: {
		thisOnline: boolean;
		balance: number;
		points: number;
		maskedPhone: string | null;
	} = $props();
</script>

<!-- App bar / balance header -->
<header class="bg-brand text-white">
	<div class="flex items-center justify-between px-3 py-3 lg:px-8 lg:py-4">
		<img src={logo} alt="parafiber by parasat logo" class="h-8 w-auto lg:h-[30px]" />
		<div class="flex items-center gap-3 lg:gap-[18px]">
			<!-- live online/offline status (this device) -->
			<span class="flex items-center gap-1.5" title="This device's live connection to the WiFi">
				{#if thisOnline}
					<span class="h-2 w-2 rounded-full bg-online/80"></span>
					<span class="text-xs font-medium opacity-90 lg:text-[13px]">Online</span>
				{:else}
					<span class="h-2 w-2 rounded-full bg-blocked"></span>
					<span class="text-xs font-medium opacity-90 lg:text-[13px]">Offline</span>
				{/if}
			</span>
			<!-- desktop balance pill -->
			<span
				class="hidden items-baseline gap-2 rounded-full bg-white/15 px-[15px] py-2 lg:flex"
				title="Prepaid credits — spend these on access tiers"
			>
				<span class="text-xs font-medium text-white/80">Balance</span>
				<span class="font-mono text-[15px] font-semibold">{balance} credits</span>
			</span>
			<!-- desktop points pill -->
			<span
				class="hidden items-baseline gap-2 rounded-full bg-white/15 px-[15px] py-2 lg:flex"
				title="Loyalty points — redeemable for access"
			>
				<Icon name="star" size={13} class="text-points self-center" />
				<span class="font-mono text-[15px] font-semibold">{points} pts</span>
			</span>
			<!-- Help & FAQ (both breakpoints — the header cluster is always visible) -->
			<a
				href={resolve('/faq')}
				aria-label="Help & FAQ"
				title="Help & FAQ"
				class="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/15 text-white/80 transition-colors hover:bg-white/25 hover:text-white hover:cursor-pointer"
			>
				<Icon name="help-circle" size={17} />
			</a>
			<!-- desktop sign out — opens the confirm dialog (CSS peer, in the page) -->
			<label
				for="signout-confirm"
				aria-label="Sign out"
				title="Sign out"
				class="hidden h-[34px] w-[34px] items-center justify-center rounded-full bg-white/15 text-white/80 transition-colors hover:bg-white/25 hover:text-white hover:cursor-pointer lg:flex"
			>
				<Icon name="log-out" size={17} />
			</label>
		</div>
	</div>

	<!-- mobile-only large balance block. The "credits"/"points" units already label the
	numbers, so no separate "Balance" caption. Columns bottom-align (items-end). -->
	<div class="flex items-end justify-between gap-2 pr-3 pb-3 pl-4.5 lg:hidden">
		<div class="flex flex-col gap-1">
			<span class="text-[12.5px] font-medium tracking-wider uppercase opacity-80">Hi there,</span>
			<span class="font-mono text-[22px] leading-none font-semibold tracking-tight">
				{maskedPhone ?? 'Guest'}
			</span>
		</div>
		<div class="flex flex-col items-end gap-1.5">
			<span class="flex items-center gap-1.5">
				<Icon name="star" size={13} class="text-points" />
				<span class="font-mono text-[15px] font-semibold">{points}</span>
				<span class="text-[13px] font-medium opacity-80">points</span>
			</span>
			<span class="flex items-baseline gap-1.5">
				<span class="font-mono text-[22px] leading-none font-semibold tracking-tight"
					>{balance}</span
				>
				<span class="text-sm font-medium opacity-85">credits</span>
			</span>
		</div>
	</div>
</header>

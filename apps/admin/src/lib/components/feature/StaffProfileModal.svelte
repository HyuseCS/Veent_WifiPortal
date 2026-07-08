<script lang="ts">
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import CircleX from 'lucide-svelte/icons/circle-x';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import ShieldOff from 'lucide-svelte/icons/shield-off';
	import X from 'lucide-svelte/icons/x';
	import type { Component } from 'svelte';
	import type { StaffMember, StaffStatus, StatusTone } from '$lib/types';
	import { Avatar, BaseDialog, IconButton, StatusBadge } from '$lib/components/ui';
	import StaffRoleBadge from './StaffRoleBadge.svelte';
	import StaffProfileField from './StaffProfileField.svelte';
	import StaffMemberActions from './StaffMemberActions.svelte';

	// Read-first profile detail for a staff member, opened from the table's Member cell.
	// Displays the full profile (identity + account + contact) and hosts the management
	// actions via the shared <StaffMemberActions>. Promotion / owner-change bubble up so the
	// parent can close this modal before opening the step-up dialog.
	let {
		open = $bindable(false),
		member,
		currentUserId,
		ownerCount,
		onPromote,
		onOwnerChange
	}: {
		open?: boolean;
		member: StaffMember | null;
		currentUserId?: string;
		ownerCount: number;
		onPromote?: (member: StaffMember) => void;
		onOwnerChange?: (member: StaffMember) => void;
	} = $props();

	// Same status → tone/label mapping the table uses (kept local; it's a stable 3-row map).
	const statusMeta: Record<StaffStatus, { tone: StatusTone; label: string }> = {
		active: { tone: 'online', label: 'Active' },
		pending: { tone: 'warning', label: 'Invitation sent' },
		disabled: { tone: 'blocked', label: 'Disabled' }
	};

	const asIcon = (c: unknown) => c as Component;
</script>

<BaseDialog bind:open class="max-w-2xl max-h-[85vh] overflow-y-auto">
	{#if member}
		<!-- Identity header -->
		<div class="flex items-start gap-3 sm:gap-4">
			<Avatar src={member.image} name={member.name} class="h-12 w-12 text-base" />
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-2">
					<h2 class="truncate text-lg font-semibold text-ink">{member.name}</h2>
					<StaffRoleBadge role={member.role} label={member.roleLabel} />
				</div>
				<p class="mt-0.5 truncate font-mono text-xs text-muted">{member.email}</p>
				<div class="mt-2">
					<StatusBadge
						tone={statusMeta[member.status].tone}
						label={statusMeta[member.status].label}
					/>
				</div>
			</div>
			<IconButton icon={asIcon(X)} label="Close" onclick={() => (open = false)} />
		</div>

		<!-- Account + Contact side by side on wider screens — uses the extra width and keeps
		     the modal short enough to avoid vertical overflow. -->
		<div class="mt-5 grid gap-x-8 gap-y-4 border-t border-border pt-4 md:grid-cols-2">
			<section>
				<h3 class="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Account</h3>
				<dl class="grid grid-cols-2 gap-x-4">
					<StaffProfileField label="Last active" value={member.lastActive} mono />
					<StaffProfileField label="Joined" value={member.joined} mono />
					<StaffProfileField label="Email verified">
						{#if member.emailVerified}
							<CircleCheck class="h-3.5 w-3.5 shrink-0 text-online" aria-hidden="true" /> Verified
						{:else}
							<CircleX class="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" /> Not verified
						{/if}
					</StaffProfileField>
					<StaffProfileField label="Two-factor auth">
						{#if member.twoFactorEnabled}
							<ShieldCheck class="h-3.5 w-3.5 shrink-0 text-online" aria-hidden="true" /> Enabled
						{:else}
							<ShieldOff class="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" /> Disabled
						{/if}
					</StaffProfileField>
				</dl>
			</section>

			<!-- Contact (unset until an edit UI exists → em-dash) -->
			<section>
				<h3 class="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Contact</h3>
				<dl class="grid grid-cols-2 gap-x-4">
					<StaffProfileField label="Phone" value={member.phone} mono />
					<StaffProfileField label="Job title" value={member.jobTitle} />
					<StaffProfileField label="Contact email" value={member.contactEmail} mono />
				</dl>
			</section>
		</div>

		<!-- Actions -->
		<section class="mt-5 border-t border-border pt-4">
			<h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Manage</h3>
			<!-- Remount per member so the inline remove-confirm never carries across members. -->
			{#key member.id}
				<StaffMemberActions
					{member}
					{currentUserId}
					{ownerCount}
					layout="modal"
					{onPromote}
					{onOwnerChange}
				/>
			{/key}
		</section>
	{/if}
</BaseDialog>

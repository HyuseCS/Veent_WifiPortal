<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import Check from 'lucide-svelte/icons/check';
	import Crown from 'lucide-svelte/icons/crown';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import ShieldOff from 'lucide-svelte/icons/shield-off';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import UserCog from 'lucide-svelte/icons/user-cog';
	import X from 'lucide-svelte/icons/x';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import type { StaffMember } from '$lib/types';
	import { Button, IconButton } from '$lib/components/ui';

	// Single source of truth for a member's management actions + the gating rules that
	// decide which are available. Rendered in TWO places: the staff table row
	// (`layout="row"`, compact icon buttons) and the profile modal footer
	// (`layout="modal"`, full-width labelled buttons). Both branches read the SAME derived
	// gates below, so the row and modal can never drift on who-can-do-what.
	//
	// Mutations post directly to the page's form actions (?/setStatus, ?/setStaffRole,
	// ?/remove); the route enforces owner access server-side. Promotion and owner
	// demotion/removal are NOT posted here — they need the step-up dialogs, so those
	// buttons call back to the parent (`onPromote` / `onOwnerChange`), which owns those
	// dialogs (and, from the modal, closes the profile modal first).
	let {
		member,
		currentUserId,
		ownerCount,
		layout = 'row',
		onPromote,
		onOwnerChange
	}: {
		member: StaffMember;
		currentUserId?: string;
		ownerCount: number;
		layout?: 'row' | 'modal';
		onPromote?: (member: StaffMember) => void;
		onOwnerChange?: (member: StaffMember) => void;
	} = $props();

	// Inline two-step confirm for remove (local so each row/modal instance is independent).
	// Callers mount one instance per member (rows key by member.id in the {#each}; the modal
	// wraps this in {#key member.id}), so this resets naturally when the member changes.
	let confirming = $state(false);

	// --- Gating (identical logic for both layouts) ---
	const isOwner = $derived(member.role === 'owner');
	const isSelf = $derived(member.id === currentUserId);
	const isActive = $derived(member.status === 'active');
	const isDisabled = $derived(member.status === 'disabled');
	const canPromote = $derived(member.role === 'admin' && isActive);
	const canMakeSysAdmin = $derived(member.role === 'admin' && isActive);
	const canUnmakeSysAdmin = $derived(member.role === 'system_admin' && isActive);
	// Owner rows can only be demoted/removed when a second owner exists (last-owner guard).
	const showOwnerChange = $derived(isOwner && ownerCount >= 2);

	const asIcon = (c: unknown) => c as Component;
</script>

{#if layout === 'row'}
	<!-- Compact icon cluster, right-aligned — the original table-row affordance. -->
	{#if !isOwner}
		{#if confirming}
			<div class="flex items-center justify-end gap-1">
				<span class="text-xs text-muted">Remove {member.name}?</span>
				<form
					method="post"
					action="?/remove"
					use:enhance={() =>
						async ({ update }) => {
							confirming = false;
							await update();
						}}
				>
					<input type="hidden" name="userId" value={member.id} />
					<IconButton
						type="submit"
						icon={asIcon(Check)}
						label="Confirm removing {member.name}"
						tone="danger"
					/>
				</form>
				<IconButton icon={asIcon(X)} label="Cancel" onclick={() => (confirming = false)} />
			</div>
		{:else}
			<div class="flex items-center justify-end gap-1">
				{#if canPromote}
					<IconButton
						icon={asIcon(Crown)}
						label="Give {member.name} the owner role"
						onclick={() => onPromote?.(member)}
					/>
				{/if}
				{#if canMakeSysAdmin}
					<form method="post" action="?/setStaffRole" use:enhance>
						<input type="hidden" name="userId" value={member.id} />
						<input type="hidden" name="role" value="system_admin" />
						<IconButton
							type="submit"
							icon={asIcon(ShieldCheck)}
							label="Make {member.name} a System Admin"
						/>
					</form>
				{:else if canUnmakeSysAdmin}
					<form method="post" action="?/setStaffRole" use:enhance>
						<input type="hidden" name="userId" value={member.id} />
						<input type="hidden" name="role" value="admin" />
						<IconButton
							type="submit"
							icon={asIcon(ShieldOff)}
							label="Remove {member.name}'s System Admin role"
						/>
					</form>
				{/if}
				{#if isDisabled}
					<form method="post" action="?/setStatus" use:enhance>
						<input type="hidden" name="userId" value={member.id} />
						<input type="hidden" name="status" value="active" />
						<IconButton type="submit" icon={asIcon(RotateCcw)} label="Reactivate {member.name}" />
					</form>
				{:else}
					<form method="post" action="?/setStatus" use:enhance>
						<input type="hidden" name="userId" value={member.id} />
						<input type="hidden" name="status" value="disabled" />
						<IconButton
							type="submit"
							icon={asIcon(Ban)}
							label="Suspend {member.name}"
							tone="danger"
						/>
					</form>
				{/if}
				<IconButton
					icon={asIcon(Trash2)}
					label="Remove {member.name}"
					tone="danger"
					onclick={() => (confirming = true)}
				/>
			</div>
		{/if}
	{:else if showOwnerChange}
		<div class="flex items-center justify-end gap-1">
			<IconButton
				icon={asIcon(UserCog)}
				label={isSelf ? 'Step down as owner' : `Demote or remove ${member.name}`}
				tone="danger"
				onclick={() => onOwnerChange?.(member)}
			/>
		</div>
	{/if}
{:else}
	<!-- Modal footer: labelled buttons that wrap — auto width reads better than stretched
	     full-width buttons in the wider modal. Same gates as the row. -->
	<div class="flex flex-wrap gap-2">
		{#if !isOwner}
			{#if canPromote}
				<Button variant="secondary" onclick={() => onPromote?.(member)}>
					<Crown class="h-4 w-4" aria-hidden="true" /> Promote to owner
				</Button>
			{/if}
			{#if canMakeSysAdmin}
				<form method="post" action="?/setStaffRole" use:enhance>
					<input type="hidden" name="userId" value={member.id} />
					<input type="hidden" name="role" value="system_admin" />
					<Button type="submit" variant="secondary">
						<ShieldCheck class="h-4 w-4" aria-hidden="true" /> Make System Admin
					</Button>
				</form>
			{:else if canUnmakeSysAdmin}
				<form method="post" action="?/setStaffRole" use:enhance>
					<input type="hidden" name="userId" value={member.id} />
					<input type="hidden" name="role" value="admin" />
					<Button type="submit" variant="secondary">
						<ShieldOff class="h-4 w-4" aria-hidden="true" /> Remove System Admin
					</Button>
				</form>
			{/if}
			{#if isDisabled}
				<form method="post" action="?/setStatus" use:enhance>
					<input type="hidden" name="userId" value={member.id} />
					<input type="hidden" name="status" value="active" />
					<Button type="submit" variant="secondary">
						<RotateCcw class="h-4 w-4" aria-hidden="true" /> Reactivate
					</Button>
				</form>
			{:else}
				<form method="post" action="?/setStatus" use:enhance>
					<input type="hidden" name="userId" value={member.id} />
					<input type="hidden" name="status" value="disabled" />
					<Button type="submit" variant="danger">
						<Ban class="h-4 w-4" aria-hidden="true" /> Suspend
					</Button>
				</form>
			{/if}
			{#if confirming}
				<form
					method="post"
					action="?/remove"
					use:enhance={() =>
						async ({ update }) => {
							confirming = false;
							await update();
						}}
				>
					<input type="hidden" name="userId" value={member.id} />
					<Button type="submit" variant="danger-solid">
						<Check class="h-4 w-4" aria-hidden="true" /> Confirm remove {member.name}
					</Button>
				</form>
				<Button variant="secondary" onclick={() => (confirming = false)}>Cancel</Button>
			{:else}
				<Button variant="danger" onclick={() => (confirming = true)}>
					<Trash2 class="h-4 w-4" aria-hidden="true" /> Remove
				</Button>
			{/if}
		{:else if showOwnerChange}
			<Button variant="danger" onclick={() => onOwnerChange?.(member)}>
				<UserCog class="h-4 w-4" aria-hidden="true" />
				{isSelf ? 'Step down as owner' : 'Demote or remove'}
			</Button>
		{:else}
			<p class="text-sm text-muted">No actions available for this member.</p>
		{/if}
	</div>
{/if}

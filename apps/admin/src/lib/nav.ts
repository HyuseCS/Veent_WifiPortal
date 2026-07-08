import type { Component } from 'svelte';
// lucide-svelte v1 dropped the named-export barrel; icons import per subpath.
import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
import Router from 'lucide-svelte/icons/router';
import MapPin from 'lucide-svelte/icons/map-pin';
import UserCog from 'lucide-svelte/icons/user-cog';
import Users from 'lucide-svelte/icons/users';
import ClipboardList from 'lucide-svelte/icons/clipboard-list';
import TrendingUp from 'lucide-svelte/icons/trending-up';
import FileCog from 'lucide-svelte/icons/file-cog';
import Activity from 'lucide-svelte/icons/activity';

/** A sidebar navigation entry. */
export interface NavItem {
	href: string;
	label: string;
	icon: Component;
	/** Only the owner sees this entry (e.g. Staff management). */
	ownerOnly?: boolean;
}

/** Primary admin navigation — order is the display order in the sidebar. */
export const nav: NavItem[] = [
	{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard as unknown as Component },
	{ href: '/networks', label: 'Networks', icon: Router as unknown as Component },
	{ href: '/map', label: 'Map', icon: MapPin as unknown as Component },
	{ href: '/users', label: 'Users', icon: Users as unknown as Component },
	{ href: '/finance', label: 'Finance', icon: TrendingUp as unknown as Component },
	{
		href: '/content',
		label: 'Content Management',
		icon: FileCog as unknown as Component,
		ownerOnly: true
	},
	{ href: '/staff', label: 'Staff', icon: UserCog as unknown as Component, ownerOnly: true },
	// Visible to all staff: managers (owner/system_admin) see the full board; other admins
	// see only the incidents assigned to them. Access is enforced in the route's load, not here.
	// Route stays /issues (table is admin_issue); "Incidents" is the user-facing label only.
	{ href: '/issues', label: 'Incidents', icon: ClipboardList as unknown as Component },
	{ href: '/sentry', label: 'Sentry', icon: Activity as unknown as Component }
];

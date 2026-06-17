import type { Component } from 'svelte';
// lucide-svelte v1 dropped the named-export barrel; icons import per subpath.
import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
import Router from 'lucide-svelte/icons/router';
import Users from 'lucide-svelte/icons/users';

/** A sidebar navigation entry. */
export interface NavItem {
	href: string;
	label: string;
	icon: Component;
}

/** Primary admin navigation — order is the display order in the sidebar. */
export const nav: NavItem[] = [
	{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard as unknown as Component },
	{ href: '/networks', label: 'Networks', icon: Router as unknown as Component },
	{ href: '/users', label: 'Users', icon: Users as unknown as Component }
];

// Shared admin-shell UI state. The mobile nav drawer's open/close is read by both the
// Topbar hamburger and the MobileDrawer (siblings under (app)/+layout.svelte), so it lives
// here rather than being prop-drilled. Mutate the property — an exported $state proxy shares
// across modules. ponytail: one boolean; grow into an object only if more shell state appears.
export const mobileNav = $state({ open: false });

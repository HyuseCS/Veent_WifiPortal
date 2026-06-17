/**
 * MOCK fixtures for the admin dashboard — frontend-only stand-ins.
 *
 * Each export is typed against `$lib/types`. When the backend lands, delete the
 * relevant import in a page and replace it with `data` from a `load()` that
 * returns the same shape. Search this file's exports to find every seam.
 */
import type {
	ActiveSession,
	AdminUserRow,
	Kpi,
	NetworkAp,
	RevenuePoint
} from '$lib/types';

// MOCK: replace with aggregate queries when backend lands.
export const kpis: Kpi[] = [
	{ label: 'Gross Revenue', value: '₱12,480', delta: '+8.2%', trend: 'up' },
	{ label: 'Active Sessions', value: '142', delta: '+12', trend: 'up' },
	{ label: 'Free-Time Grants', value: '309', delta: '-4.1%', trend: 'down' },
	{ label: 'Avg. Session', value: '24m', delta: '+1m', trend: 'up' }
];

// MOCK: replace with revenue-by-day query when backend lands.
export const revenue: RevenuePoint[] = [
	{ label: 'Mon', amount: 1480 },
	{ label: 'Tue', amount: 1920 },
	{ label: 'Wed', amount: 1660 },
	{ label: 'Thu', amount: 2240 },
	{ label: 'Fri', amount: 2980 },
	{ label: 'Sat', amount: 3420 },
	{ label: 'Sun', amount: 2780 }
];

// MOCK: replace with live session query (SSE in production) when backend lands.
export const activeSessions: ActiveSession[] = [
	{ mac: 'A4:83:E7:1C:9F:02', package: '30 Min', timeLeft: '18:42', tone: 'online', status: 'Online' },
	{ mac: '3C:5A:B4:7E:11:DD', package: '1 Hour', timeLeft: '42:08', tone: 'online', status: 'Online' },
	{ mac: 'F0:9F:C2:08:65:1A', package: 'Free Time', timeLeft: '02:14', tone: 'warning', status: 'Low Time' },
	{ mac: '8C:85:90:0B:3E:77', package: '30 Min', timeLeft: '00:00', tone: 'blocked', status: 'Expired' },
	{ mac: 'DC:A6:32:44:9C:21', package: '3 Hours', timeLeft: '02:51:30', tone: 'online', status: 'Online' }
];

// MOCK: replace with per-AP telemetry when backend lands.
export const networks: NetworkAp[] = [
	{ id: 'ap-1', name: 'AP — Ground Floor', tone: 'online', status: 'Healthy', uptime: '99.8%', latency: '12ms', users: 38, throughput: '84 Mbps' },
	{ id: 'ap-2', name: 'AP — Floor 2', tone: 'online', status: 'Healthy', uptime: '99.5%', latency: '15ms', users: 27, throughput: '61 Mbps' },
	{ id: 'ap-3', name: 'AP — Cafe Patio', tone: 'warning', status: 'Degraded', uptime: '97.1%', latency: '48ms', users: 12, throughput: '22 Mbps' },
	{ id: 'ap-4', name: 'AP — Parking Lobby', tone: 'blocked', status: 'Offline', uptime: '0.0%', latency: '—', users: 0, throughput: '0 Mbps' }
];

// MOCK: replace with paginated user query when backend lands.
export const users: AdminUserRow[] = [
	{ id: 'u-1', name: 'Maria Santos', email: 'maria.santos@gmail.com', balance: 48, usage: '4.2 GB', tone: 'online', status: 'Active' },
	{ id: 'u-2', name: 'Juan Dela Cruz', email: 'juandc@yahoo.com', balance: 6, usage: '11.8 GB', tone: 'warning', status: 'Low Balance' },
	{ id: 'u-3', name: 'Liza Reyes', email: 'liza.reyes@gmail.com', balance: 120, usage: '1.1 GB', tone: 'online', status: 'Active' },
	{ id: 'u-4', name: 'Mark Villanueva', email: 'mark.v@outlook.com', balance: 0, usage: '23.4 GB', tone: 'blocked', status: 'Blocked' },
	{ id: 'u-5', name: 'Andrea Lim', email: 'andrea.lim@gmail.com', balance: 32, usage: '6.7 GB', tone: 'online', status: 'Active' }
];

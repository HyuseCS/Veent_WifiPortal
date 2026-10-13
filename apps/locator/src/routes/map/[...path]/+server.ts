import type { RequestHandler } from './$types';
import { proxyMap } from '$lib/server/mapProxy';

export const GET: RequestHandler = ({ url, request }) => proxyMap(url, request);

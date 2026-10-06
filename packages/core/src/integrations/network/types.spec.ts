import { afterEach, describe, expect, it, vi } from 'vitest';
import { logMacSource } from './types';

afterEach(() => vi.restoreAllMocks());

describe('logMacSource', () => {
	it('writes one masked [mac-diag] line', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		logMacSource('lease', 'F4:B7:8D:A6:80:88', '10.210.44.159');
		expect(info).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith('[mac-diag]', {
			source: 'lease',
			mac: '**:**:**:**:80:88',
			ip: '10.210.*.*'
		});
	});

	it('gives null for a null MAC and a null IP', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		logMacSource('none', null, null);
		expect(info).toHaveBeenCalledWith('[mac-diag]', { source: 'none', mac: null, ip: null });
	});
});

'use strict';

const http = require('node:http');
const https = require('node:https');

const DEVICE_PROBE_PATH = '/api/v1/devices?limit=1';
const PROBE_TIMEOUT_MS = 10_000;

const checkedAt = () => new Date().toISOString();
const probeResult = (status, message, extra = {}) => ({ checkedAt: checkedAt(), message, status, ...extra });
const responseSupportsDevices = (status, contentType) =>
	status === 401 ||
	status === 403 ||
	(status >= 200 &&
		status < 300 &&
		String(contentType || '')
			.toLowerCase()
			.includes('json'));
const responseFailure = (status) =>
	status === 404 ? 'This deployment does not expose the computers API yet.' : `The computers API returned HTTP ${status || 'unknown'}.`;

function requestDeviceProbe(target, userAgent, redirectCount = 0) {
	const client = target.protocol === 'http:' ? http : https;
	return new Promise((resolve) => {
		const request = client.get(target, { headers: { Accept: 'application/json', 'User-Agent': userAgent } }, (response) => {
			const status = response.statusCode || 0;
			const location = response.headers.location;
			response.resume();
			if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 3) {
				const redirected = new URL(location, target);
				if (redirected.origin !== target.origin) {
					resolve(probeResult('incompatible', 'That Thingtime endpoint redirects its API to another origin.'));
					return;
				}
				resolve(requestDeviceProbe(redirected, userAgent, redirectCount + 1));
				return;
			}
			if (responseSupportsDevices(status, response.headers['content-type'])) {
				resolve(probeResult('compatible', 'Computers API is available.', { directStatus: status }));
				return;
			}
			resolve(probeResult('incompatible', responseFailure(status), { directStatus: status }));
		});
		request.setTimeout(PROBE_TIMEOUT_MS, () => request.destroy(new Error('timeout')));
		request.on('error', () => resolve(probeResult('unreachable', 'Thingtime could not reach this API endpoint.')));
	});
}

async function probeEndpointDevices(rawUrl, { userAgent = 'Thingtime desktop' } = {}) {
	let endpoint;
	try {
		endpoint = new URL(rawUrl);
	} catch {
		return probeResult('incompatible', 'Choose a valid Thingtime API endpoint.');
	}
	return requestDeviceProbe(new URL(DEVICE_PROBE_PATH, endpoint), userAgent);
}

async function probeBundledProxy({ endpointUrl, origin, fetchImpl = globalThis.fetch }) {
	if (!origin || typeof fetchImpl !== 'function') return probeResult('unreachable', 'The packaged API proxy is not ready yet.');
	const expectedOrigin = new URL(endpointUrl).origin;
	try {
		const response = await fetchImpl(new URL(DEVICE_PROBE_PATH, origin), { headers: { Accept: 'application/json' } });
		const proxiedOrigin = response.headers.get('x-thingtime-api-fallback');
		if (proxiedOrigin !== expectedOrigin) return probeResult('incompatible', 'The packaged API proxy is not using the selected endpoint.');
		if (!responseSupportsDevices(response.status, response.headers.get('content-type'))) {
			return probeResult('incompatible', responseFailure(response.status), { proxyStatus: response.status });
		}
		return probeResult('compatible', 'Packaged API proxy is using the selected endpoint.', { proxyStatus: response.status });
	} catch {
		return probeResult('unreachable', 'The packaged API proxy could not reach the selected endpoint.');
	}
}

async function checkEndpointCompatibility({ endpointUrl, origin, userAgent }) {
	const direct = await probeEndpointDevices(endpointUrl, { userAgent });
	if (direct.status !== 'compatible') return { ...direct, direct, proxy: null };
	const proxy = await probeBundledProxy({ endpointUrl, origin });
	if (proxy.status !== 'compatible') return { ...proxy, direct, proxy };
	return probeResult('compatible', 'This endpoint supports computers and the packaged API proxy is in sync.', { direct, proxy });
}

const compatibilityError = (compatibility) => new Error(compatibility?.message || 'This Thingtime endpoint is not compatible with computers.');

module.exports = {
	DEVICE_PROBE_PATH,
	checkEndpointCompatibility,
	compatibilityError,
	probeBundledProxy,
	probeEndpointDevices,
	responseSupportsDevices
};

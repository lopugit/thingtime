'use strict';

const http = require('node:http');
const https = require('node:https');

const DEVICE_PROBE_PATH = '/api/v1/devices?limit=1';
const CAPABILITIES_PROBE_PATH = '/api/v1/capabilities';
const PROBE_TIMEOUT_MS = 10_000;
// The packaged desktop exposes the current closed device-control vocabulary,
// including consented app volume plus approval-gated Accessibility input. Do not activate that surface on
// an origin whose advertised devices contract predates it.
const DESKTOP_REQUIRED_CAPABILITIES = Object.freeze({
	'api.capabilities': '^1.1.0',
	'api.devices': '^1.8.0'
});

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
const parseVersion = (value) => {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''));
	return match ? match.slice(1).map(Number) : null;
};
const supportsVersion = (version, range) => {
	const actual = parseVersion(version);
	const minimum = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(String(range || ''));
	if (!actual || !minimum) return false;
	const expected = minimum.slice(1).map(Number);
	return actual[0] === expected[0] && (actual[1] > expected[1] || (actual[1] === expected[1] && actual[2] >= expected[2]));
};
const hasDeploymentDataEnvironment = (value) =>
	value &&
	value.schemaVersion === 1 &&
	typeof value.id === 'string' &&
	/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) &&
	['production', 'development', 'custom'].includes(value.kind) &&
	typeof value.federationId === 'string' &&
	/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.federationId) &&
	(typeof value.authorityOrigin === 'string' && /^https:\/\/[^/]+$/i.test(value.authorityOrigin));

function requestJson(target, userAgent) {
	const client = target.protocol === 'http:' ? http : https;
	return new Promise((resolve) => {
		const request = client.get(target, { headers: { Accept: 'application/json', 'User-Agent': userAgent } }, (response) => {
			let body = '';
			response.setEncoding('utf8');
			response.on('data', (chunk) => {
				if (body.length <= 64 * 1024) body += chunk;
			});
			response.on('end', () => resolve({ body, contentType: response.headers['content-type'], status: response.statusCode || 0 }));
		});
		request.setTimeout(PROBE_TIMEOUT_MS, () => request.destroy(new Error('timeout')));
		request.on('error', () => resolve(null));
	});
}

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

async function probeEndpointCapabilities(rawUrl, { userAgent = 'Thingtime desktop', required = DESKTOP_REQUIRED_CAPABILITIES } = {}) {
	let endpoint;
	try {
		endpoint = new URL(rawUrl);
	} catch {
		return probeResult('incompatible', 'Choose a valid Thingtime API endpoint.');
	}
	const response = await requestJson(new URL(CAPABILITIES_PROBE_PATH, endpoint), userAgent);
	if (!response) return probeResult('unreachable', 'Thingtime could not reach this API endpoint.');
	if (response.status === 404) return probeResult('legacy', 'This deployment has not published the capability manifest yet.');
	if (
		response.status < 200 ||
		response.status >= 300 ||
		!String(response.contentType || '')
			.toLowerCase()
			.includes('json')
	) {
		return probeResult('incompatible', `The capability manifest returned HTTP ${response.status || 'unknown'}.`);
	}
	try {
		const manifest = JSON.parse(response.body);
		if (manifest?.ok !== true || manifest?.schemaVersion !== 1 || !manifest.features || typeof manifest.features !== 'object') {
			return probeResult('incompatible', 'This deployment returned an invalid capability manifest.');
		}
		const missing = Object.entries(required).find(([feature, range]) => !supportsVersion(manifest.features[feature], range));
		if (missing) return probeResult('incompatible', `This deployment does not support ${missing[0]} ${missing[1]}.`, { manifest });
		if (required['api.capabilities'] && !hasDeploymentDataEnvironment(manifest.dataEnvironment)) {
			return probeResult('incompatible', 'This deployment has not published a valid data-environment identity.', { manifest });
		}
		return probeResult('compatible', 'This deployment supports the desktop API contract.', { manifest });
	} catch {
		return probeResult('incompatible', 'This deployment returned an invalid capability manifest.');
	}
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
	const manifest = await probeEndpointCapabilities(endpointUrl, { userAgent });
	const direct = manifest.status === 'legacy' ? await probeEndpointDevices(endpointUrl, { userAgent }) : manifest;
	if (direct.status !== 'compatible') return { ...direct, direct, proxy: null };
	const proxy = await probeBundledProxy({ endpointUrl, origin });
	if (proxy.status !== 'compatible') return { ...proxy, direct, proxy };
	return probeResult('compatible', 'This endpoint supports computers and the packaged API proxy is in sync.', { direct, proxy });
}

const compatibilityError = (compatibility) => new Error(compatibility?.message || 'This Thingtime endpoint is not compatible with computers.');

module.exports = {
	DEVICE_PROBE_PATH,
	CAPABILITIES_PROBE_PATH,
	DESKTOP_REQUIRED_CAPABILITIES,
	checkEndpointCompatibility,
	compatibilityError,
	probeBundledProxy,
	probeEndpointCapabilities,
	probeEndpointDevices,
	responseSupportsDevices,
	hasDeploymentDataEnvironment,
	supportsVersion
};

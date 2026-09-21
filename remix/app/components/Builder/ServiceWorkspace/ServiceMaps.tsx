import React from 'react';
import { serviceTitle, type ServiceRecord } from '~/schemas/serviceWorkspace';
import { workspaceRequest } from './client';
let sdk: Promise<any> | null = null;
let sdkKey: string | null = null;
export function loadServiceMaps(key: string): Promise<any> {
	if (sdkKey && sdkKey !== key) return Promise.reject(new Error('Map environment changed. Reload this page to use its Google Maps key.'));
	if (sdk) return sdk;
	sdkKey = key;
	sdk = new Promise((resolve, reject) => {
		const w = window as any;
		if (w.google?.maps?.importLibrary) {
			resolve(w.google.maps);
			return;
		}
		const script = document.createElement('script');
		const callback = '__thingtimeServiceMapsReady';
		const timeout = window.setTimeout(() => {
			delete w[callback];
			script.remove();
			reject(new Error('Google Maps timed out. Check your connection and API restrictions.'));
		}, 15000);
		w[callback] = () => {
			clearTimeout(timeout);
			delete w[callback];
			resolve(w.google.maps);
		};
		const url = new URL('https://maps.googleapis.com/maps/api/js');
		url.searchParams.set('key', key);
		url.searchParams.set('v', 'weekly');
		url.searchParams.set('loading', 'async');
		url.searchParams.set('callback', callback);
		script.src = url.toString();
		script.async = true;
		script.onerror = () => {
			clearTimeout(timeout);
			delete w[callback];
			script.remove();
			reject(new Error('Google Maps could not load. Check your connection and API restrictions.'));
		};
		document.head.appendChild(script);
	}).catch((error) => {
		sdk = null;
		sdkKey = null;
		throw error;
	});
	return sdk;
}
export function ServiceAddressSearch({
	rootId,
	selected,
	report
}: {
	rootId: string;
	selected: (address: string, placeId: string) => void;
	report: (error: unknown) => void;
}) {
	const [query, setQuery] = React.useState('');
	const [results, setResults] = React.useState<{ id: string; text: string }[]>([]);
	const [error, setError] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const generation = React.useRef(0);
	const session = React.useRef(crypto.randomUUID());
	React.useEffect(() => {
		const current = ++generation.current;
		let cancelled = false;
		setResults([]);
		setError('');
		if (query.trim().length < 3) return;
		const timer = setTimeout(() => {
			void workspaceRequest(rootId, { operation: 'searchAddresses', query, sessionToken: session.current })
				.then((result) => {
					if (!cancelled && current === generation.current) setResults(result.suggestions);
				})
				.catch((error) => {
					if (!cancelled && current === generation.current) setError(error.message);
				});
		}, 400);
		return () => {
			clearTimeout(timer);
			cancelled = true;
		};
	}, [query, rootId]);
	async function choose(id: string) {
		if (busy) return;
		setBusy(true);
		try {
			const place = await workspaceRequest(rootId, { operation: 'place', placeId: id, sessionToken: session.current });
			selected(place.address, place.placeId);
			setQuery('');
			setResults([]);
			session.current = crypto.randomUUID();
		} catch (error) {
			report(error);
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="sw-wide">
			<label>
				<span>Find an address</span>
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Start typing a street address…"
					autoComplete="off"
					aria-label="Search Google addresses"
					disabled={busy}
				/>
			</label>
			{results.length > 0 && (
				<div className="sw-suggestions">
					{results.map((result) => (
						<button type="button" key={result.id} disabled={busy} onClick={() => void choose(result.id)}>
							{result.text}
						</button>
					))}
					<img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" width="120" height="14" />
				</div>
			)}
			{error && (
				<p role="status" className="sw-muted">
					{error} You can enter the address manually below.
				</p>
			)}
		</div>
	);
}
export function ServiceMap({
	rootId,
	apiKey,
	addresses,
	open,
	report
}: {
	rootId: string;
	apiKey: string | null;
	addresses: ServiceRecord[];
	open: (id: string) => void;
	report: (error: unknown) => void;
}) {
	const host = React.useRef<HTMLDivElement>(null);
	const [loading, setLoading] = React.useState(false);
	const addressKey = addresses.map((r) => `${r.id}:${r.updatedAt}`).join('|');
	const addressRecords = React.useRef(addresses);
	addressRecords.current = addresses;
	const callbacks = React.useRef({ open, report });
	callbacks.current = { open, report };
	React.useEffect(() => {
		if (!apiKey) return;
		let live = true;
		const markers: any[] = [];
		setLoading(true);
		void loadServiceMaps(apiKey)
			.then(async (maps) => {
				const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')]);
				if (!live || !host.current) return;
				const map = new Map(host.current, { center: { lat: -37.81, lng: 144.96 }, zoom: 11, mapId: 'DEMO_MAP_ID', mapTypeControl: true });
				const bounds = new maps.LatLngBounds();
				let count = 0;
				const list = addressRecords.current.filter((r) => r.values.placeId).slice(0, 50);
				for (let start = 0; live && start < list.length; start += 4) {
					await Promise.all(
						list.slice(start, start + 4).map(async (address) => {
							const place = await workspaceRequest(rootId, { operation: 'place', recordId: address.id });
							if (!live || !place.location) return;
							const position = { lat: place.location.latitude, lng: place.location.longitude };
							const marker = new AdvancedMarkerElement({ map, position, title: serviceTitle(address), gmpClickable: true });
							marker.addListener('click', () => callbacks.current.open(address.id));
							markers.push(marker);
							bounds.extend(position);
							count++;
						})
					);
				}
				if (live && count) {
					map.fitBounds(bounds);
					if (count === 1) maps.event.addListenerOnce(map, 'idle', () => map.setZoom(15));
				}
			})
			.catch((error) => {
				if (live) callbacks.current.report(error);
			})
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
			markers.forEach((marker) => {
				marker.map = null;
			});
		};
	}, [apiKey, rootId, addressKey]);
	if (!apiKey)
		return (
			<div className="sw-empty">
				<h3>Connect your property map</h3>
				<p>Add GOOGLE_MAPS_JAVASCRIPT_API_KEY and GOOGLE_PLACES_API_KEY in your Thingtime Vault. See Setup for API and website restrictions.</p>
			</div>
		);
	return (
		<section>
			<div className="sw-map" ref={host} aria-label="Property map" />
			<p className="sw-muted">
				{loading ? 'Locating properties… ' : ''}Showing up to 50 matching properties. Search to narrow the map. Properties need a Google address
				selection to appear.
			</p>
		</section>
	);
}

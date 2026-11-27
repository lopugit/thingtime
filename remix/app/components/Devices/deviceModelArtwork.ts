/** Public model identifiers only: never send a serial number or device identity
 * to a third-party lookup service. Catalog images are served locally. Unknown
 * models keep an honest generic icon; authors can replace the saved image block. */
export type DeviceModelArtwork = {
	src: string | null;
	alt: string;
	fallback: string;
	credit: string | null;
	sourceUrl: string | null;
	licenseUrl: string | null;
	match: 'model' | 'family' | 'generic';
};

const phone: DeviceModelArtwork = {
	src: '/assets/devices/iphone-15-pro-max.png',
	alt: 'iPhone 15 Pro Max · representative model photo',
	fallback: '📱',
	credit: 'Ka Kit Pang · CC BY-SA 4.0',
	sourceUrl: 'https://commons.wikimedia.org/wiki/File:IPhone_15_pro_max.png',
	licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
	match: 'model',
};
const macbook: DeviceModelArtwork = {
	src: '/assets/devices/macbook-pro-14-m3.jpg',
	alt: '14-inch MacBook Pro, M3 family · representative model photo',
	fallback: '💻',
	credit: 'Kyu3a; crop by TenthAvenueFreezeOut · CC BY-SA 4.0',
	sourceUrl: 'https://commons.wikimedia.org/wiki/File:M3_Macbook_Pro_14_inch_Space_Grey_model_(cropped).jpg',
	licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
	match: 'family',
};

export function deviceModelArtwork(model: string | null | undefined, platform?: string | null): DeviceModelArtwork {
	const value = typeof model === 'string' ? model.trim().toLowerCase() : '';
	if (value === 'iphone16,2' || value === 'iphone 15 pro max') return { ...phone };
	// Apple's public model guide maps these identifiers to the 14-inch Nov 2023 family.
	if (/^mac15,(3|6|8|10)$/.test(value)) return { ...macbook };
	const family = `${platform ?? ''} ${value}`.toLowerCase();
	const fallback = /watch/.test(family) ? '⌚' : /iphone|ipad|ios|android/.test(family) ? '📱' : /mac|windows|linux/.test(family) ? '💻' : '📍';
	return { src: null, alt: model?.trim() || 'Device', fallback, credit: null, sourceUrl: null, licenseUrl: null, match: 'generic' };
}

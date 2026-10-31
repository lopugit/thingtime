export type Rgba = { r: number; g: number; b: number; a: number };
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const rgbaToHex = (c: Rgba): string =>
	'#' + [c.r, c.g, c.b, ...(c.a < 1 ? [c.a * 255] : [])].map((n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')).join('');
export const hslToRgba = (h: number, s: number, l: number, a = 1): Rgba => {
	h = (((h % 360) + 360) % 360) / 360;
	s = clamp(s / 100);
	l = clamp(l / 100);
	const f = (n: number) => {
		const k = (n + h * 12) % 12;
		return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
	};
	return { r: f(0), g: f(8), b: f(4), a: clamp(a) };
};
export const rgbaToHsl = ({ r, g, b }: Rgba): [number, number, number] => {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b),
		min = Math.min(r, g, b),
		d = max - min,
		l = (max + min) / 2;
	const h = !d ? 0 : max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
	return [h, d ? (d / (1 - Math.abs(2 * l - 1))) * 100 : 0, l * 100];
};
/** Parse only numeric CSS colours. Never let arbitrary CSS into saved text. */
export const parseColor = (raw: string): Rgba | null => {
	const value = raw.trim();
	if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
		let hex = value.slice(1);
		if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16),
			a: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1
		};
	}
	const match = /^(rgba?|hsla?)\(\s*([+\-\d.%\s,/]+)\s*\)$/i.exec(value);
	if (!match) return null;
	const parts = match[2].trim().split(/[\s,/]+/);
	if (parts.length < 3 || parts.length > 4 || parts.some((p) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(p))) return null;
	const n = parts.map(parseFloat);
	if (n.some((v) => !Number.isFinite(v))) return null;
	const a = clamp(parts[3]?.endsWith('%') ? n[3] / 100 : n[3] ?? 1);
	if (match[1].toLowerCase().startsWith('hsl')) {
		if (parts[0].endsWith('%') || !parts[1].endsWith('%') || !parts[2].endsWith('%')) return null;
		return hslToRgba(n[0], n[1], n[2], a);
	}
	return {
		r: clamp(n[0] * (parts[0].endsWith('%') ? 2.55 : 1), 0, 255),
		g: clamp(n[1] * (parts[1].endsWith('%') ? 2.55 : 1), 0, 255),
		b: clamp(n[2] * (parts[2].endsWith('%') ? 2.55 : 1), 0, 255),
		a
	};
};

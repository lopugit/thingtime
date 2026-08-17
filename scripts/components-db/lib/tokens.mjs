// Design-token sets for every source library the Thingtime component catalog
// mirrors. Each archetype builder styles itself ONLY through these tokens, so
// one builder yields eight library-authentic renditions. All styling is inline
// (the HtmlThingRenderer allowlist has no external CSS), so tokens carry
// everything: palette, radii, shadows, type, control metrics.
//
// Palette entries: solid = filled control background, onSolid = text on it,
// soft = tinted background, onSoft = text on the tint, border = tint border.

const font = {
	system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
	inter: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	roboto: "Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif",
	mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
};

export const LIBRARIES = {
	antd: {
		id: 'antd',
		label: 'Ant Design',
		blurb: 'Enterprise-calm blue, 6px corners, quiet borders',
		font: font.system,
		fontMono: font.mono,
		text: 'rgba(0, 0, 0, 0.88)',
		muted: 'rgba(0, 0, 0, 0.45)',
		faint: 'rgba(0, 0, 0, 0.25)',
		bg: '#f5f5f5',
		surface: '#ffffff',
		surfaceAlt: '#fafafa',
		border: '#d9d9d9',
		borderSoft: '#f0f0f0',
		radius: { xs: '4px', sm: '6px', md: '6px', lg: '8px', pill: '999px' },
		shadow: {
			sm: '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02)',
			md: '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12)',
			lg: '0 9px 28px 8px rgba(0, 0, 0, 0.05), 0 6px 16px 0 rgba(0, 0, 0, 0.08)'
		},
		control: { sm: '24px', md: '32px', lg: '40px' },
		fontSize: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px' },
		buttonWeight: 400,
		headingWeight: 600,
		focusRing: '0 0 0 2px rgba(5, 145, 255, 0.1)',
		palette: {
			primary: { solid: '#1677ff', onSolid: '#ffffff', soft: '#e6f4ff', onSoft: '#0958d9', border: '#91caff' },
			success: { solid: '#52c41a', onSolid: '#ffffff', soft: '#f6ffed', onSoft: '#389e0d', border: '#b7eb8f' },
			warning: { solid: '#faad14', onSolid: '#ffffff', soft: '#fffbe6', onSoft: '#d48806', border: '#ffe58f' },
			danger: { solid: '#ff4d4f', onSolid: '#ffffff', soft: '#fff2f0', onSoft: '#cf1322', border: '#ffccc7' },
			info: { solid: '#1677ff', onSolid: '#ffffff', soft: '#e6f4ff', onSoft: '#0958d9', border: '#91caff' },
			neutral: { solid: 'rgba(0, 0, 0, 0.88)', onSolid: '#ffffff', soft: '#fafafa', onSoft: 'rgba(0, 0, 0, 0.65)', border: '#d9d9d9' }
		}
	},

	bootstrap: {
		id: 'bootstrap',
		label: 'Bootstrap',
		blurb: 'The web’s workhorse: familiar blues, .375rem corners',
		font: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
		fontMono: font.mono,
		text: '#212529',
		muted: '#6c757d',
		faint: '#adb5bd',
		bg: '#f8f9fa',
		surface: '#ffffff',
		surfaceAlt: '#f8f9fa',
		border: '#dee2e6',
		borderSoft: '#e9ecef',
		radius: { xs: '4px', sm: '6px', md: '6px', lg: '8px', pill: '50rem' },
		shadow: {
			sm: '0 .125rem .25rem rgba(0, 0, 0, .075)',
			md: '0 .5rem 1rem rgba(0, 0, 0, .15)',
			lg: '0 1rem 3rem rgba(0, 0, 0, .175)'
		},
		control: { sm: '31px', md: '38px', lg: '48px' },
		fontSize: { xs: '12px', sm: '14px', md: '16px', lg: '18px', xl: '20px' },
		buttonWeight: 400,
		headingWeight: 500,
		focusRing: '0 0 0 0.25rem rgba(13, 110, 253, 0.25)',
		palette: {
			primary: { solid: '#0d6efd', onSolid: '#ffffff', soft: '#cfe2ff', onSoft: '#052c65', border: '#9ec5fe' },
			success: { solid: '#198754', onSolid: '#ffffff', soft: '#d1e7dd', onSoft: '#0a3622', border: '#a3cfbb' },
			warning: { solid: '#ffc107', onSolid: '#000000', soft: '#fff3cd', onSoft: '#664d03', border: '#ffe69c' },
			danger: { solid: '#dc3545', onSolid: '#ffffff', soft: '#f8d7da', onSoft: '#58151c', border: '#f1aeb5' },
			info: { solid: '#0dcaf0', onSolid: '#000000', soft: '#cff4fc', onSoft: '#055160', border: '#9eeaf9' },
			neutral: { solid: '#6c757d', onSolid: '#ffffff', soft: '#e9ecef', onSoft: '#495057', border: '#ced4da' }
		}
	},

	mui: {
		id: 'mui',
		label: 'Material UI',
		blurb: 'Material elevation, Roboto, UPPERCASE buttons',
		font: font.roboto,
		fontMono: font.mono,
		text: 'rgba(0, 0, 0, 0.87)',
		muted: 'rgba(0, 0, 0, 0.6)',
		faint: 'rgba(0, 0, 0, 0.38)',
		bg: '#f5f5f5',
		surface: '#ffffff',
		surfaceAlt: '#fafafa',
		border: 'rgba(0, 0, 0, 0.12)',
		borderSoft: 'rgba(0, 0, 0, 0.08)',
		radius: { xs: '4px', sm: '4px', md: '4px', lg: '8px', pill: '999px' },
		shadow: {
			sm: '0px 2px 1px -1px rgba(0,0,0,0.2), 0px 1px 1px 0px rgba(0,0,0,0.14), 0px 1px 3px 0px rgba(0,0,0,0.12)',
			md: '0px 3px 1px -2px rgba(0,0,0,0.2), 0px 2px 2px 0px rgba(0,0,0,0.14), 0px 1px 5px 0px rgba(0,0,0,0.12)',
			lg: '0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12)'
		},
		control: { sm: '30px', md: '36px', lg: '42px' },
		fontSize: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px' },
		buttonWeight: 500,
		headingWeight: 500,
		uppercaseButtons: true,
		buttonLetterSpacing: '0.02857em',
		focusRing: '0 0 0 3px rgba(25, 118, 210, 0.18)',
		palette: {
			primary: { solid: '#1976d2', onSolid: '#ffffff', soft: '#e3f2fd', onSoft: '#1565c0', border: '#90caf9' },
			success: { solid: '#2e7d32', onSolid: '#ffffff', soft: '#edf7ed', onSoft: '#1e4620', border: '#a5d6a7' },
			warning: { solid: '#ed6c02', onSolid: '#ffffff', soft: '#fff4e5', onSoft: '#663c00', border: '#ffb74d' },
			danger: { solid: '#d32f2f', onSolid: '#ffffff', soft: '#fdeded', onSoft: '#5f2120', border: '#ef9a9a' },
			info: { solid: '#0288d1', onSolid: '#ffffff', soft: '#e5f6fd', onSoft: '#014361', border: '#81d4fa' },
			neutral: { solid: '#616161', onSolid: '#ffffff', soft: '#eeeeee', onSoft: '#424242', border: '#bdbdbd' }
		}
	},

	shadcn: {
		id: 'shadcn',
		label: 'shadcn/ui',
		blurb: 'Zinc-on-white minimalism, near-black actions, Inter',
		font: font.inter,
		fontMono: font.mono,
		text: '#09090b',
		muted: '#71717a',
		faint: '#a1a1aa',
		bg: '#fafafa',
		surface: '#ffffff',
		surfaceAlt: '#f4f4f5',
		border: '#e4e4e7',
		borderSoft: '#f4f4f5',
		radius: { xs: '6px', sm: '8px', md: '8px', lg: '12px', pill: '999px' },
		shadow: {
			sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
			md: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
			lg: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)'
		},
		control: { sm: '32px', md: '36px', lg: '40px' },
		fontSize: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '18px' },
		buttonWeight: 500,
		headingWeight: 600,
		focusRing: '0 0 0 2px #ffffff, 0 0 0 4px #a1a1aa',
		palette: {
			primary: { solid: '#18181b', onSolid: '#fafafa', soft: '#f4f4f5', onSoft: '#18181b', border: '#e4e4e7' },
			success: { solid: '#16a34a', onSolid: '#ffffff', soft: '#f0fdf4', onSoft: '#15803d', border: '#bbf7d0' },
			warning: { solid: '#f59e0b', onSolid: '#ffffff', soft: '#fffbeb', onSoft: '#b45309', border: '#fde68a' },
			danger: { solid: '#ef4444', onSolid: '#fafafa', soft: '#fef2f2', onSoft: '#b91c1c', border: '#fecaca' },
			info: { solid: '#3b82f6', onSolid: '#ffffff', soft: '#eff6ff', onSoft: '#1d4ed8', border: '#bfdbfe' },
			neutral: { solid: '#71717a', onSolid: '#ffffff', soft: '#f4f4f5', onSoft: '#3f3f46', border: '#e4e4e7' }
		}
	},

	untitled: {
		id: 'untitled',
		label: 'Untitled UI',
		blurb: 'SaaS-polished purple, soft grays, feather shadows',
		font: font.inter,
		fontMono: font.mono,
		text: '#101828',
		muted: '#475467',
		faint: '#98a2b3',
		bg: '#f9fafb',
		surface: '#ffffff',
		surfaceAlt: '#f9fafb',
		border: '#eaecf0',
		borderSoft: '#f2f4f7',
		radius: { xs: '6px', sm: '8px', md: '8px', lg: '12px', pill: '999px' },
		shadow: {
			sm: '0 1px 2px rgba(16, 24, 40, 0.05)',
			md: '0 1px 3px rgba(16, 24, 40, 0.1), 0 1px 2px rgba(16, 24, 40, 0.06)',
			lg: '0 12px 16px -4px rgba(16, 24, 40, 0.08), 0 4px 6px -2px rgba(16, 24, 40, 0.03)'
		},
		control: { sm: '36px', md: '40px', lg: '44px' },
		fontSize: { xs: '12px', sm: '14px', md: '14px', lg: '16px', xl: '18px' },
		buttonWeight: 600,
		headingWeight: 600,
		focusRing: '0 0 0 4px #f4ebff',
		palette: {
			primary: { solid: '#7f56d9', onSolid: '#ffffff', soft: '#f9f5ff', onSoft: '#6941c6', border: '#e9d7fe' },
			success: { solid: '#12b76a', onSolid: '#ffffff', soft: '#ecfdf3', onSoft: '#027a48', border: '#a6f4c5' },
			warning: { solid: '#f79009', onSolid: '#ffffff', soft: '#fffaeb', onSoft: '#b54708', border: '#fedf89' },
			danger: { solid: '#f04438', onSolid: '#ffffff', soft: '#fef3f2', onSoft: '#b42318', border: '#fecdca' },
			info: { solid: '#2e90fa', onSolid: '#ffffff', soft: '#eff8ff', onSoft: '#175cd3', border: '#b2ddff' },
			neutral: { solid: '#344054', onSolid: '#ffffff', soft: '#f2f4f7', onSoft: '#344054', border: '#d0d5dd' }
		}
	},

	daisyui: {
		id: 'daisyui',
		label: 'daisyUI',
		blurb: 'Playful Tailwind flavors: bold colors, friendly corners',
		font: font.inter,
		fontMono: font.mono,
		text: '#1f2937',
		muted: '#6b7280',
		faint: '#9ca3af',
		bg: '#f2f2f2',
		surface: '#ffffff',
		surfaceAlt: '#f2f2f2',
		border: '#e5e6e6',
		borderSoft: '#f2f2f2',
		radius: { xs: '8px', sm: '8px', md: '12px', lg: '16px', pill: '999px' },
		shadow: {
			sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
			md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
			lg: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
		},
		control: { sm: '32px', md: '48px', lg: '56px' },
		fontSize: { xs: '12px', sm: '14px', md: '14px', lg: '18px', xl: '20px' },
		buttonWeight: 600,
		headingWeight: 700,
		focusRing: '0 0 0 2px #ffffff, 0 0 0 4px #570df8',
		palette: {
			primary: { solid: '#570df8', onSolid: '#ffffff', soft: '#eee6ff', onSoft: '#4506cb', border: '#d6c4fd' },
			success: { solid: '#00a96e', onSolid: '#ffffff', soft: '#dcfce7', onSoft: '#00753d', border: '#86efac' },
			warning: { solid: '#ffbe00', onSolid: '#382800', soft: '#fef9c3', onSoft: '#854d0e', border: '#fde047' },
			danger: { solid: '#ff5861', onSolid: '#ffffff', soft: '#ffe4e6', onSoft: '#be123c', border: '#fda4af' },
			info: { solid: '#00b6ff', onSolid: '#ffffff', soft: '#e0f2fe', onSoft: '#0369a1', border: '#7dd3fc' },
			neutral: { solid: '#2a323c', onSolid: '#ffffff', soft: '#f2f2f2', onSoft: '#2a323c', border: '#d1d5db' }
		}
	},

	reactflow: {
		id: 'reactflow',
		label: 'React Flow',
		blurb: 'Node-graph chrome: crisp nodes, handles, dotted canvases',
		font: font.system,
		fontMono: font.mono,
		text: '#1a192b',
		muted: '#6f6e77',
		faint: '#b1b1b7',
		bg: '#f8f8f8',
		surface: '#ffffff',
		surfaceAlt: '#f4f4f5',
		border: '#1a192b',
		borderSoft: '#e2e2e5',
		radius: { xs: '2px', sm: '3px', md: '5px', lg: '8px', pill: '999px' },
		shadow: {
			sm: '0 1px 2px rgba(26, 25, 43, 0.08)',
			md: '0 2px 6px rgba(26, 25, 43, 0.12)',
			lg: '0 0 0 0.5px #1a192b, 0 3px 10px rgba(26, 25, 43, 0.15)'
		},
		control: { sm: '24px', md: '30px', lg: '38px' },
		fontSize: { xs: '10px', sm: '12px', md: '12px', lg: '14px', xl: '16px' },
		buttonWeight: 500,
		headingWeight: 600,
		focusRing: '0 0 0 0.5px #1a192b',
		accent: '#ff0072',
		edge: '#b1b1b7',
		dot: '#91919a',
		palette: {
			primary: { solid: '#1a192b', onSolid: '#ffffff', soft: '#f4f4f5', onSoft: '#1a192b', border: '#1a192b' },
			success: { solid: '#22c55e', onSolid: '#ffffff', soft: '#f0fdf4', onSoft: '#15803d', border: '#86efac' },
			warning: { solid: '#eab308', onSolid: '#ffffff', soft: '#fefce8', onSoft: '#a16207', border: '#fde047' },
			danger: { solid: '#ff0072', onSolid: '#ffffff', soft: '#ffe4f1', onSoft: '#c00055', border: '#ff77b3' },
			info: { solid: '#784be8', onSolid: '#ffffff', soft: '#f1ecfd', onSoft: '#5b21b6', border: '#c4b5fd' },
			neutral: { solid: '#6f6e77', onSolid: '#ffffff', soft: '#f4f4f5', onSoft: '#3f3e4a', border: '#b1b1b7' }
		}
	},

	thingtime: {
		id: 'thingtime',
		label: 'Thingtime',
		blurb: 'House style: greyscale calm with a rainbow wink',
		font: font.inter,
		fontMono: font.mono,
		text: '#33333c',
		muted: '#9a9aa6',
		faint: '#b6b6c0',
		bg: '#fafafb',
		surface: '#ffffff',
		surfaceAlt: '#f5f5f7',
		border: '#ececef',
		borderSoft: '#f5f5f7',
		radius: { xs: '7px', sm: '9px', md: '12px', lg: '16px', pill: '999px' },
		shadow: {
			sm: '0 1px 2px rgba(22, 22, 26, 0.04)',
			md: '0 4px 12px rgba(22, 22, 26, 0.06)',
			lg: '0 12px 32px rgba(22, 22, 26, 0.10)'
		},
		control: { sm: '28px', md: '36px', lg: '44px' },
		fontSize: { xs: '11px', sm: '12px', md: '14px', lg: '16px', xl: '18px' },
		buttonWeight: 600,
		headingWeight: 700,
		focusRing: '0 0 0 3px rgba(213, 63, 140, 0.15)',
		ink: '#16161a',
		rainbow: 'linear-gradient(90deg, #ff5f6d, #ffc371, #ffe66d, #7cf47c, #6ad6ff, #a78bfa, #f472b6)',
		palette: {
			primary: { solid: '#16161a', onSolid: '#ffffff', soft: '#f5f5f7', onSoft: '#16161a', border: '#ececef' },
			success: { solid: '#2f9e63', onSolid: '#ffffff', soft: '#eafaf1', onSoft: '#1f7a4a', border: '#bfe9d2' },
			warning: { solid: '#d99a1f', onSolid: '#ffffff', soft: '#fdf6e5', onSoft: '#9a6c12', border: '#f2ddaa' },
			danger: { solid: '#d5484f', onSolid: '#ffffff', soft: '#fdeceb', onSoft: '#a83238', border: '#f4c1c3' },
			info: { solid: '#d53f8c', onSolid: '#ffffff', soft: '#fdeaf3', onSoft: '#a32d6a', border: '#f6bed9' },
			neutral: { solid: '#9a9aa6', onSolid: '#ffffff', soft: '#f5f5f7', onSoft: '#5a5a66', border: '#ececef' }
		}
	}
};

export const LIBRARY_IDS = Object.keys(LIBRARIES);

export const TONES = ['primary', 'success', 'warning', 'danger', 'info', 'neutral'];

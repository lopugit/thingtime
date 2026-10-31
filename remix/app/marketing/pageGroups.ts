import { COMPETITOR_BY_KEY } from './competitors';
import { FEATURE_BY_KEY, FEATURE_CATEGORY_LABELS } from './features';
import { PERSONA_BY_KEY } from './personas';
import { TREND_BY_KEY } from './trends';
import type { MarketingPage } from './types';
import { USE_CASE_BY_KEY } from './useCases';

// How a category index (and /marketing/search) buckets its pages: by the one
// reference that best explains a page — its trend, audience, competitor, use
// case, or feature family.
//
// `key` is namespaced ("persona:developers", "family:developer") and `label`
// is the human name. The two are NOT interchangeable: display names are only
// unique *within* a namespace, and at least one name — "Developers" — is both
// a persona and a feature family. /marketing/search mixes every namespace in
// one result set, so a label reused as a React key renders two sibling
// sections under the same key. Group by `key`, and render by `key`.

export type PageGroup = { key: string; label: string; emoji: string; pages: MarketingPage[] };

export const groupLabel = (entry: MarketingPage): { key: string; label: string; emoji: string } => {
	if (entry.refs.trend) {
		const trend = TREND_BY_KEY[entry.refs.trend];
		return { key: `trend:${trend.key}`, label: trend.name, emoji: trend.emoji };
	}
	if (entry.refs.persona) {
		const persona = PERSONA_BY_KEY[entry.refs.persona];
		return { key: `persona:${persona.key}`, label: persona.name, emoji: persona.emoji };
	}
	if (entry.refs.competitor) {
		const competitor = COMPETITOR_BY_KEY[entry.refs.competitor];
		return { key: `competitor:${competitor.key}`, label: competitor.name, emoji: competitor.emoji };
	}
	if (entry.refs.useCase && entry.kind !== 'template') {
		const useCase = USE_CASE_BY_KEY[entry.refs.useCase];
		return { key: `use-case:${useCase.key}`, label: useCase.name, emoji: useCase.emoji };
	}
	if (entry.refs.feature) {
		const feature = FEATURE_BY_KEY[entry.refs.feature];
		const label = FEATURE_CATEGORY_LABELS[feature.category];
		return { key: `family:${feature.category}`, label: label.name, emoji: label.emoji };
	}
	return { key: 'all', label: 'All', emoji: '📄' };
};

/** Buckets pages in first-seen order. Group keys are unique; labels may repeat. */
export const groupPages = (pages: readonly MarketingPage[]): PageGroup[] => {
	const map = new Map<string, PageGroup>();
	for (const entry of pages) {
		const group = groupLabel(entry);
		const bucket = map.get(group.key) ?? { key: group.key, label: group.label, emoji: group.emoji, pages: [] };
		bucket.pages.push(entry);
		map.set(group.key, bucket);
	}
	return [...map.values()];
};

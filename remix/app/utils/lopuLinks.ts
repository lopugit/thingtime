/** Bounded, inert navigation receipts shared by live cards and saved history. */
export type LopuToolLink = { label: string; href: string };
const record = (value: unknown): Record<string, any> | null =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
export const safeLopuHref = (value: unknown): string | null => {
	const href = text(value);
	if (!href || href.length > 2048 || /[\\\s\u0000-\u001f\u007f]/.test(href)) return null;
	if (/^\/(?!\/)/.test(href)) return href;
	if (!/^https?:\/\//i.test(href)) return null;
	try {
		const url = new URL(href);
		return url.username || url.password ? null : href;
	} catch {
		return null;
	}
};
export const normalizeLopuLinks = (value: unknown): LopuToolLink[] => {
	const links: LopuToolLink[] = [];
	for (const raw of Array.isArray(value) ? value.slice(0, 100) : []) {
		const item = record(raw);
		const href = safeLopuHref(item?.href);
		if (href && !links.some((link) => link.href === href)) links.push({ href, label: text(item?.label).slice(0, 180) || 'Open' });
	}
	return links;
};

/** Only traverse known public reference envelopes, never arbitrary tool payloads. */
export const lopuResultLinks = (data: unknown): LopuToolLink[] => {
	const links: LopuToolLink[] = [];
	const seen = new Set<unknown>();
	const push = (href: unknown, label: string) => {
		const safe = safeLopuHref(href);
		if (safe && links.length < 100 && !links.some((link) => link.href === safe)) links.push({ href: safe, label: label.slice(0, 180) });
	};
	const visit = (value: unknown, fallback?: string, depth = 0) => {
		if (depth > 4 || links.length >= 100 || seen.size >= 1000 || seen.has(value)) return;
		if (Array.isArray(value)) {
			seen.add(value);
			for (const entry of value.slice(0, 100)) visit(entry, fallback, depth + 1);
			return;
		}
		const item = record(value);
		if (!item) return;
		seen.add(value);
		const crystal = record(item.crystal) || {};
		const id = text(item.id);
		const kind = text(item.kind) || (Array.isArray(item.thingtime) ? text(item.thingtime[0]) : '') || fallback;
		const name = text(crystal.name) || text(item.name) || text(item.title);
		if (id && (kind || fallback === 'thing')) {
			// Route keys are kind-scoped: an action's key must never address a
			// component route (or vice versa), so each kind reads only its own
			// key before falling back to the generic `key` and finally the id.
			const keyFor = (own: unknown, alsoOwn: unknown) => encodeURIComponent(text(own) || text(alsoOwn) || text(item.key) || id);
			if (kind === 'webpage') push(`/builder?page=${encodeURIComponent(id)}`, `Open ${name || 'the page'} in the builder`);
			else if (kind === 'component') push(`/components/${keyFor(crystal.componentKey, item.componentKey)}`, `Open ${name || 'the component'}`);
			else if (kind === 'action') push(`/actions/${keyFor(crystal.actionKey, item.actionKey)}`, `Open ${name || 'the action'}`);
			else if (kind === 'schema') push(`/schemas/${encodeURIComponent(id)}`, `Open ${name || 'the schema'}`);
			else push(`/thing/${encodeURIComponent(id)}`, `Open ${name || 'the thing'}`);
		}
		for (const [key, type] of Object.entries({
			thing: 'thing',
			page: 'webpage',
			component: 'component',
			action: 'action',
			schema: 'schema',
			subject: 'thing',
			reminder: ''
		}))
			visit(item[key], type, depth + 1);
		for (const key of ['pageId', 'entryPageId']) if (text(item[key])) push(`/builder?page=${encodeURIComponent(item[key])}`, 'Open in the builder');
		if (text(item.schemaId)) push(`/schemas/${encodeURIComponent(item.schemaId)}`, 'Open schema');
		if (Array.isArray(item.relatedThingIds))
			for (const id of item.relatedThingIds.slice(0, 100)) {
				if (text(id)) push(`/thing/${encodeURIComponent(id)}`, 'Open related thing');
			}
		for (const key of ['chatId', 'destinationChatId']) if (text(item[key])) push(`/lopu/${encodeURIComponent(item[key])}`, 'Open conversation');
		for (const key of ['thingId', 'targetId', 'parentId']) if (text(item[key])) push(`/thing/${encodeURIComponent(item[key])}`, 'Open related thing');
		for (const source of [item, crystal])
			for (const key of ['href', 'url', 'siteRoute', 'path', 'entryPath']) {
				if (safeLopuHref(source[key])) push(source[key], `Open ${name || source[key]}`);
			}
		for (const [key, type] of Object.entries({ pageIds: 'webpage', componentIds: 'component', actionIds: 'action', schemaIds: 'schema' })) {
			for (const [name, id] of Object.entries(record(item[key]) || {}).slice(0, 100)) visit({ id, name }, type, depth + 1);
		}
		for (const [key, type] of Object.entries({
			things: 'thing',
			hits: 'thing',
			components: 'component',
			actions: 'action',
			pages: 'webpage',
			schemas: 'schema',
			comments: 'comment',
			reminders: 'thing',
			related: 'thing',
			relatedThings: 'thing',
			references: 'thing',
			links: '',
			results: 'thing'
		})) {
			if (Array.isArray(item[key]))
				for (const entry of item[key].slice(0, 100)) {
					if (typeof entry === 'string') push(entry, `Open ${entry}`);
					else visit(entry, type, depth + 1);
				}
		}
	};
	visit(data);
	return links;
};

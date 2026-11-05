const containers = new Set(['container', 'element', 'collection', 'condition']);

/** Traverse authored composition edges in order without treating reused values
 * as cycles. HTTP validation owns the block schema; this walk grants no access. */
export function* pageBlockTraversal(blocks: unknown): Generator<Record<string, any>> {
	if (!Array.isArray(blocks)) return;
	const active = new WeakSet<object>();
	const stack: { items: unknown[]; index: number; owner?: object }[] = [{ items: blocks, index: 0 }];
	active.add(blocks);
	while (stack.length) {
		const frame = stack[stack.length - 1];
		if (frame.index >= frame.items.length) {
			active.delete(frame.items);
			if (frame.owner) active.delete(frame.owner);
			stack.pop();
			continue;
		}
		const block = frame.items[frame.index++];
		if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
		if (active.has(block)) throw new Error('Page block tree contains a cycle.');
		const value = block as Record<string, any>;
		yield value;
		if (!containers.has(value.type) || !Array.isArray(value.children)) continue;
		if (active.has(value.children)) throw new Error('Page block tree contains a cycle.');
		active.add(block);
		active.add(value.children);
		stack.push({ items: value.children, index: 0, owner: block });
	}
}

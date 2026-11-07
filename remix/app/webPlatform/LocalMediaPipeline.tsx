import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { NativeControlsEnabled } from '~/components/Builder/NativeComponentControls';
import { validateMediaPipeline, type MediaPipeline } from './mediaPipeline';
import { bindMediaPipeline } from './liveMediaPipeline';
import { createHostMediaPipeline } from './hostMediaPipeline';
import { scopeMediaControls } from './mediaControlScope';
import { mediaExport } from './mediaExport';

/** Selected-file adapter only. Every visible control is an ordinary authored
 * child element, so Builder selection, styling and rearranging stay intact. */
export default function LocalMediaPipeline({
	pipeline: raw,
	children,
	editorProps
}: {
	pipeline?: unknown;
	children?: React.ReactNode;
	editorProps?: Record<string, any>;
}) {
	const [prefix] = React.useState(() => 'media' + crypto.randomUUID().replace(/-/g, '').slice(0, 12));
	const root = React.useRef<HTMLElement>(null);
	const enabled = React.useContext(NativeControlsEnabled);
	const actor = useCurrentUser()?.id;
	const serialized = JSON.stringify(raw);
	const [error, setError] = React.useState('');
	React.useLayoutEffect(() => {
		if (!root.current || !enabled) return;
		const element = root.current;
		let binding: (() => void) | undefined;
		let host: ReturnType<typeof createHostMediaPipeline> | undefined;
		let outputUrl: string | undefined;
		let pipeline: MediaPipeline | undefined;
		let restore = () => {};
		const receivers = new Set<(requestId: number, result: any) => void>();
		const publish = (value: unknown) => {
			if (outputUrl) URL.revokeObjectURL(outputUrl);
			outputUrl = undefined;
			if (!pipeline?.download) return;
			const matches = element.querySelectorAll(pipeline.download);
			if (matches.length !== 1 || !(matches[0] instanceof HTMLAnchorElement)) throw new Error('Media download requires one authored link');
			const link = matches[0];
			link.removeAttribute('href');
			link.removeAttribute('download');
			link.hidden = true;
			link.style.display = 'none';
			const file = mediaExport(value);
			if (file) {
				outputUrl = URL.createObjectURL(file.blob);
				link.href = outputUrl;
				link.download = file.name;
				link.hidden = false;
				link.style.display = 'inline-block';
			}
		};
		try {
			const original = JSON.parse(serialized);
			validateMediaPipeline(original);
			const scoped = scopeMediaControls(element, original, prefix);
			const parsed = scoped.pipeline;
			pipeline = parsed;
			restore = scoped.restore;
			const inputs = () => {
				const values: Record<string, unknown> = {};
				for (const option of Object.values(parsed.output)) {
					if (!option || typeof option !== 'object') continue;
					const matches = Array.from(element.querySelectorAll('input, select, textarea')).filter((node) => node.getAttribute('name') === option.name);
					if (matches.length !== 1) throw new Error(`Media setting ${option.name} requires one named field`);
					const field = matches[0] as HTMLInputElement;
					values[option.name] = field.type === 'number' || field.type === 'range' ? (field.value === '' ? '' : field.valueAsNumber) : field.value;
				}
				return values;
			};
			host = createHostMediaPipeline(
				parsed,
				inputs,
				() => new Worker(new URL('./mediaWorker.ts', import.meta.url), { type: 'module' }),
				(id, result) => receivers.forEach((receive) => receive(id, result)),
				async (signal) => (await import('./imageAssets')).loadImageWasmAssets(signal)
			);
			binding = bindMediaPipeline(element, parsed, inputs(), () => {}, publish, {
				send: (message) => host?.receive(message),
				subscribe: (receive) => {
					receivers.add(receive);
					return () => receivers.delete(receive);
				}
			});
			setError('');
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Invalid media controls');
		}
		return () => {
			binding?.();
			host?.dispose();
			receivers.clear();
			if (outputUrl) URL.revokeObjectURL(outputUrl);
			if (pipeline) {
				const file = element.querySelector(pipeline.file);
				if (file instanceof HTMLInputElement) file.value = '';
			}
			restore();
		};
	}, [serialized, enabled, actor, prefix]);
	return (
		<section {...editorProps} ref={root}>
			{children}
			{error && <p role="status">{error}</p>}
		</section>
	);
}

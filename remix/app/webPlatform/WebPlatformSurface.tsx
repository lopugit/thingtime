import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { validatePlatformProgram } from './compiler';
import type { PlatformProgram } from './types';

/** Generic builder primitive: the entire document, styles, program and input
 * descriptors come from the component Thing. No feature ID or app UI here. */
export default function WebPlatformSurface({ program: raw }: { program?: unknown }) {
	const user = useCurrentUser();
	const serialized = JSON.stringify([user?.id ?? null, raw ?? null]);
	return <PlatformInstance key={serialized} raw={raw} />;
}
function PlatformInstance({ raw }: { raw: unknown }) {
	let initial: PlatformProgram | null = null;
	let invalid = '';
	try {
		initial = validatePlatformProgram(raw);
	} catch (e) {
		invalid = e instanceof Error ? e.message : 'Invalid program';
	}
	const [definition, setDefinition] = React.useState(() => JSON.stringify(initial, null, 2));
	const [inputs, setInputs] = React.useState<Record<string, unknown>>(() =>
		Object.fromEntries((initial?.parameters || []).map((p) => [p.name, p.type === 'json' ? JSON.stringify(p.default) : p.default]))
	);
	const [job, setJob] = React.useState<{ program: PlatformProgram; input: Record<string, unknown>; id: string } | null>(null);
	const [result, setResult] = React.useState('');
	const [error, setError] = React.useState('');
	const frame = React.useRef<HTMLIFrameElement>(null);
	React.useEffect(() => {
		if (!job) return;
		let ready = false;
		const receive = (e: MessageEvent) => {
			if (e.source !== frame.current?.contentWindow) return;
			if (e.data?.type === 'tt-platform-ready' && !ready) {
				ready = true;
				frame.current?.contentWindow?.postMessage({ type: 'tt-platform-start', program: job.program, input: job.input, runId: job.id }, '*');
			}
			if (e.data?.type === 'tt-platform-result' && e.data.runId === job.id && typeof e.data.text === 'string' && e.data.text.length <= 65536) {
				setResult(e.data.text);
				setError(e.data.ok ? '' : e.data.text);
			}
		};
		addEventListener('message', receive);
		const timeout = setTimeout(() => {
			if (!ready) setError('The isolated runtime did not load. Retry after the deployment finishes.');
		}, 10000);
		return () => {
			removeEventListener('message', receive);
			clearTimeout(timeout);
		};
	}, [job]);
	if (!initial) return <p role="note">{invalid}</p>;
	const run = () => {
		try {
			const program = validatePlatformProgram(JSON.parse(definition));
			const input = Object.fromEntries(
				(program.parameters || []).map((p) => [
					p.name,
					p.type === 'json' ? JSON.parse(String(inputs[p.name] ?? JSON.stringify(p.default))) : inputs[p.name] ?? p.default
				])
			);
			setJob({ program, input, id: crypto.randomUUID() });
			setError('');
			setResult('');
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Check the program and inputs');
		}
	};
	const field: React.CSSProperties = {
		font: 'inherit',
		padding: '10px 12px',
		border: '1px solid #d4d4d8',
		borderRadius: 8,
		width: '100%',
		minWidth: 0,
		background: '#fff',
		color: '#18181b',
		boxSizing: 'border-box'
	};
	return (
		<section aria-label={initial.title} style={{ display: 'grid', gap: 14, minWidth: 0 }}>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
				{initial.parameters?.map((p) => (
					<label key={p.name} style={{ display: 'grid', gap: 5, fontSize: 13 }}>
						{p.label}
						{p.type === 'boolean' ? (
							<input type="checkbox" checked={inputs[p.name] === true} onChange={(e) => setInputs({ ...inputs, [p.name]: e.target.checked })} />
						) : (
							<input
								style={field}
								type={p.type === 'number' ? 'number' : 'text'}
								value={String(inputs[p.name] ?? '')}
								maxLength={4000}
								onChange={(e) => setInputs({ ...inputs, [p.name]: p.type === 'number' ? Number(e.target.value) : e.target.value })}
							/>
						)}
					</label>
				))}
			</div>
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				<button type="button" style={{ ...field, width: 'auto', background: '#18181b', color: '#fff', cursor: 'pointer' }} onClick={run}>
					Run example
				</button>
				<button
					type="button"
					style={{ ...field, width: 'auto', cursor: 'pointer' }}
					onClick={() => {
						setJob(null);
						setResult('');
						setError('');
					}}
				>
					Stop / clear
				</button>
			</div>
			{error && (
				<p role="status" style={{ color: '#9f1239', overflowWrap: 'anywhere' }}>
					{error}
				</p>
			)}
			{job && (
				<iframe
					ref={frame}
					key={job.id}
					title={`${initial.title} interactive preview`}
					src="/platform/runtime.html"
					sandbox="allow-scripts"
					referrerPolicy="no-referrer"
					style={{
						width: '100%',
						height: job.program.document?.length ? 320 : 0,
						border: job.program.document?.length ? '1px solid #e4e4e7' : 0,
						borderRadius: 12,
						background: '#fff'
					}}
				/>
			)}
			{result && (
				<pre
					aria-label="Execution result"
					style={{
						margin: 0,
						padding: 16,
						background: '#f4f4f5',
						borderRadius: 12,
						whiteSpace: 'pre-wrap',
						overflowWrap: 'anywhere',
						maxHeight: 360,
						overflow: 'auto',
						fontSize: 12
					}}
				>
					{result}
				</pre>
			)}
			<details>
				<summary style={{ cursor: 'pointer', fontSize: 13 }}>Edit reusable program</summary>
				<p style={{ fontSize: 13 }}>
					Change the document, CSS rules, parameters and Action steps. Run uses this draft. Save the definition on your Component Thing to keep it.
				</p>
				<textarea
					aria-label="Web Platform program"
					style={{ ...field, height: 260, fontFamily: 'monospace', fontSize: 12 }}
					value={definition}
					onChange={(e) => setDefinition(e.target.value)}
					maxLength={24576}
				/>
			</details>
		</section>
	);
}

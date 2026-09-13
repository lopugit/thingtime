import { useRevalidator } from 'react-router';

/** Deliberately outside account/theme providers: no old user content, error
 * payload, stack trace, URL query, or cached profile belongs on this screen. */
export const RootRecovery = ({ refreshing = false }: { refreshing?: boolean }) => {
	const revalidator = useRevalidator();
	const busy = refreshing || revalidator.state !== 'idle';
	return (
		<main
			style={{
				minHeight: '100dvh',
				boxSizing: 'border-box',
				display: 'grid',
				placeItems: 'center',
				padding: '24px',
				background: '#fafafa',
				color: '#202020',
				fontFamily: 'system-ui, sans-serif'
			}}
		>
			<style>{'body { margin: 0; }'}</style>
			<section aria-labelledby="root-recovery-title" style={{ width: '100%', maxWidth: 440, overflowWrap: 'anywhere' }}>
				<p style={{ fontSize: 14 }}>Thingtime</p>
				<h1 id="root-recovery-title" style={{ fontSize: 26, lineHeight: 1.25 }}>
					{refreshing ? 'Refreshing your session' : 'We couldn’t load your session'}
				</h1>
				<p role="status" style={{ lineHeight: 1.6 }}>
					{refreshing
						? 'Previous account content is hidden while we check your current session.'
						: 'Check your connection, then try again. Your changes haven’t been repeated.'}
				</p>
				{!refreshing && (
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginTop: 24 }}>
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								void revalidator.revalidate();
							}}
							style={{
								font: 'inherit',
								minHeight: 44,
								padding: '10px 20px',
								borderRadius: 8,
								border: '1px solid #202020',
								background: '#202020',
								color: '#fff',
								cursor: busy ? 'wait' : 'pointer'
							}}
						>
							{busy ? 'Trying again…' : 'Try again'}
						</button>
						<button
							type="button"
							onClick={() => window.location.reload()}
							style={{
								font: 'inherit',
								minHeight: 44,
								padding: '10px',
								border: 0,
								background: 'none',
								textDecoration: 'underline',
								cursor: 'pointer'
							}}
						>
							Reload page
						</button>
					</div>
				)}
			</section>
		</main>
	);
};

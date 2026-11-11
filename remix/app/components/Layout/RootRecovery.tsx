import React from 'react';
import { useRevalidator, useRouteError } from 'react-router';
import { useBackgroundRefresh } from '../../hooks/useBackgroundRefresh';
import { RootDataUnavailableError } from '../../utils/rootDataRecovery';
import { initializeLocalHome, localHomeBootstrapAvailable } from '../../local-workspace/localHomeBootstrap.client';
import { rootIdentity } from '../../utils/rootIdentity';
import { DesktopConnectionRecovery } from '../Settings/DesktopConnectionRecovery';

/** Deliberately outside account/theme providers: no old user content, error
 * payload, stack trace, URL query, or cached profile belongs on this screen. */
export const RootRecovery = ({ refreshing = false }: { refreshing?: boolean }) => {
	const revalidator = useRevalidator();
 const error = useRouteError();
 const deviceStarting = React.useRef(false);
 const [deviceAvailable, setDeviceAvailable] = React.useState(false);
 const [deviceBusy, setDeviceBusy] = React.useState(false);
 const [deviceError, setDeviceError] = React.useState('');
 React.useEffect(() => {
  let live = true;
  if (!refreshing && error instanceof RootDataUnavailableError && error.retryable) void localHomeBootstrapAvailable().then(value => { if (live) setDeviceAvailable(value); });
  const unsubscribe = rootIdentity.subscribe(() => { if (live) setDeviceAvailable(false); });
  return () => { live = false; unsubscribe(); };
 }, [refreshing, error]);
 const startDeviceHome = async () => {
  if (deviceStarting.current) return;
  deviceStarting.current = true;
  setDeviceBusy(true); setDeviceError('');
  try { await initializeLocalHome(); setDeviceAvailable(false); void revalidator.revalidate(); }
  catch (failure) { setDeviceError(failure instanceof Error ? failure.message : 'This device-only workspace could not be initialized.'); }
  finally { deviceStarting.current = false; setDeviceBusy(false); }
 };
	useBackgroundRefresh(
		!refreshing && error instanceof RootDataUnavailableError && error.retryable ? 'root-data-recovery' : null,
		() => revalidator.state === 'idle' ? revalidator.revalidate() : undefined,
		30_000,
		false
	);
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
						? 'Your previous view is hidden while we check your current session.'
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
    {!refreshing && deviceAvailable && <div style={{ marginTop: 24 }}>
     <p style={{ lineHeight: 1.6 }}>Start a private workspace on this device. Account sign-in and sync will remain unavailable until their connection is configured.</p>
     <button type="button" disabled={busy || deviceBusy} aria-busy={deviceBusy} onClick={() => { void startDeviceHome(); }}
      style={{ font: 'inherit', minHeight: 44, padding: '10px 20px', borderRadius: 8, border: '1px solid #202020', background: '#fff', color: '#202020', cursor: deviceBusy ? 'wait' : 'pointer' }}>
      {deviceBusy && <span aria-hidden="true" style={{ marginRight: 8 }}>◌</span>}Work on this device
     </button>
     {deviceError && <p role="alert" style={{ lineHeight: 1.6 }}>{deviceError}</p>}
    </div>}
				{!refreshing && <DesktopConnectionRecovery />}
			</section>
		</main>
	);
};

// The demo's isolation canaries, loaded after /embed/thingtime.min.js so the
// SDK has installed itself. External for the same reason as demo-host.js: the
// deployed CSP has no inline-script allowance, and a blocked inline block fails
// silently — the verdict below simply never renders.

const originalThing = window.Thingtime.get();
const mutableSnapshot = window.Thingtime.get();
mutableSnapshot.headline = 'This must stay isolated';
const snapshotsAreImmutable = window.Thingtime.get('headline') === originalThing.headline;
let laterSubscriberRan = false;
const unsubscribeThrowing = window.Thingtime.subscribe(() => {
	throw new Error('Intentional isolation canary');
});
const unsubscribeLater = window.Thingtime.subscribe(() => {
	laterSubscriberRan = true;
});
window.Thingtime.configure({ initialValue: { ...originalThing, headline: 'Subscriber canary' } });
window.Thingtime.configure({ initialValue: originalThing });
unsubscribeThrowing();
unsubscribeLater();
window.Thingtime.replace({
	chakra: 'Box',
	props: {
		dangerouslySetInnerHTML: {
			__html: '<img src=x onerror="window.__thingtimeXss=true">'
		}
	}
});
window.Thingtime.replace(originalThing);
let prototypePathBlocked = false;
try {
	window.Thingtime.set('__proto__.polluted', true);
} catch {
	prototypePathBlocked = true;
}
const hostIntegrityPassed =
	window.process?.owner === 'demo-host' &&
	window.process?.env?.DEMO === 'untouched' &&
	window.meta?.owner === 'demo-host' &&
	window.tt?.owner === 'demo-host' &&
	window.thingtime?.owner === 'demo-host' &&
	window.smarts?.owner === 'demo-host' &&
	window.Thingtime?.version === '0.1.0' &&
	snapshotsAreImmutable &&
	laterSubscriberRan &&
	window.__thingtimeXss === false &&
	prototypePathBlocked &&
	{}.polluted === undefined;
const hostIntegrity = document.querySelector('#host-integrity');
hostIntegrity.dataset.passed = String(hostIntegrityPassed);
hostIntegrity.textContent = hostIntegrityPassed ? '✓ Host globals untouched' : 'Host isolation check failed';

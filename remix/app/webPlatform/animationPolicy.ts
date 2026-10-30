import type { Arg, Policy } from './domBridge';
export type AnimationArg =
	| 'animation-keyframes'
	| 'animation-timing'
	| 'animation-options'
	| 'animation-effect-options'
	| 'animation-element'
	| 'animation-effect'
	| 'animation-source'
	| 'animation-timeline'
	| 'animation-time'
	| 'animation-timeline-options'
	| 'animation-event'
	| 'animation-query'
	| 'animation-callback';
const call = (args: Arg[] = [], min = args.length) => ({ args, min });
export const ANIMATION_CONSTRUCTORS = {
	Animation: call(['animation-effect', 'animation-timeline'], 0),
	KeyframeEffect: {
		...call(['animation-element', 'animation-keyframes', 'animation-effect-options'], 2),
		overloads: [
			['animation-source'],
			['animation-element', 'animation-keyframes'],
			['animation-element', 'animation-keyframes', 'animation-effect-options']
		] as Arg[][]
	},
	DocumentTimeline: call(['animation-timeline-options'], 0),
	AnimationPlaybackEvent: call(['text', 'animation-event'], 1)
};
export const ANIMATION_ELEMENT_CALLS = {
	animate: call(['animation-keyframes', 'animation-options'], 1),
	getAnimations: call(['animation-query'], 0)
};
export const ANIMATION_GLOBALS = { Document: 'timeline' };
export const ANIMATION_STATIC = { Document: { getAnimations: call() } };
export const ANIMATION_RECEIVER_POLICY: Record<string, Policy> = {
	Animation: {
		reads:
			'id effect timeline startTime currentTime playbackRate playState replaceState pending ready finished overallProgress onfinish oncancel onremove',
		writes: 'id effect timeline startTime currentTime playbackRate onfinish oncancel onremove',
		writeArgs: {
			effect: 'animation-effect',
			timeline: 'animation-timeline',
			startTime: 'animation-time',
			currentTime: 'animation-time',
			playbackRate: 'finite',
			onfinish: 'animation-callback',
			oncancel: 'animation-callback',
			onremove: 'animation-callback'
		},
		calls: {
			cancel: call(),
			finish: call(),
			play: call(),
			pause: call(),
			reverse: call(),
			updatePlaybackRate: call(['finite']),
			persist: call(),
			commitStyles: call()
		}
	},
	KeyframeEffect: {
		reads: 'target pseudoElement composite iterationComposite',
		writes: 'target pseudoElement composite iterationComposite',
		writeArgs: { target: 'animation-element', pseudoElement: 'cssom-pseudo' },
		calls: { getKeyframes: call(), setKeyframes: call(['animation-keyframes']) }
	},
	AnimationEffect: { reads: '', calls: { getTiming: call(), getComputedTiming: call(), updateTiming: call(['animation-timing'], 0) } },
	DocumentTimeline: { reads: 'currentTime' },
	AnimationTimeline: { reads: 'currentTime duration' },
	AnimationPlaybackEvent: { reads: 'type isTrusted bubbles cancelable currentTime timelineTime' }
};

import React from 'react';
import ContentEditable from 'react-contenteditable';
import * as Chakras from '@chakra-ui/react';
import { Box, Center, Flex, Input, Select, Spinner, Switch, Textarea } from '@chakra-ui/react';

import { CommanderV1 } from '../Commander/CommanderV1Deprecated';
import { CommanderV2 } from '../Commander/CommanderV2';
// import { Magic } from "../Commander/Magic"
import { blocksToText, getEditorJsDoc, LongTextEditor, textToBlocks } from '../Editor/LongTextEditor';
import { EDITOR_JS_AUTO_DETECT_LIMITS, isEditorJsDocSafeToEdit } from '../Editor/editorJsValue';
import { Icon } from '../Icon/Icon';
import { RichTextBlocks } from '../Kinds/kindRenderersMedia';
import { useLopu } from '../Lopu/useLopu';
import { MagicInput } from '../MagicInput/MagicInput';
import { Safe } from '../Safety/Safe';
import { ThingContextMenuTrigger } from './ContextMenu/ThingContextMenuTrigger';
import { useThingtime } from './useThingtime';

import { useThings } from '~/hooks/useThings';
import { getThing } from '~/smarts';
import { safeJoin, safeSplit } from '~/utils';

type ThingtimeProps = {
	debugId?: string;
	thingtimeMachineNamespace?: string;
};

// collapse-all/expand-all cascade from the nearest ancestor: the mount
// default for newly-rendered things (null = no cascade, mount expanded).
// Context rather than props so children mounting in the same commit as the
// cascade update read the fresh value, not a memoized element's stale prop.
const CollapseCascadeContext = React.createContext<boolean | null>(null);

// Verbose per-node render/effect logging — off by default. The tree now mounts
// at feed scale (one per thingtime post via ThingView), so unconditional logs
// would flood the console and retain rendered payloads in memory for the whole
// session. Flip to true only for local debugging.
const TT_DEBUG = false;

const numberStepButtonStyles = {
	alignItems: 'center',
	justifyContent: 'center',
	width: '30px',
	height: '30px',
	border: '1px solid var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	background: 'var(--tt-card, #ffffff)',
	color: 'var(--tt-muted, #9a9aa6)',
	fontSize: '15px',
	lineHeight: 1,
	cursor: 'pointer',
	userSelect: 'none',
	transition: 'background 0.15s ease, color 0.15s ease, transform 0.1s ease',
	_hover: { background: 'var(--tt-surface-hover, #ececee)', color: 'var(--tt-ink, #16161a)' },
	_active: { transform: 'scale(0.94)' }
} as const;

// Number editor: light rounded input with − / + steppers (the design-mockup
// pattern), replacing the heavy bordered Chakra NumberInput. Keeps a local
// draft so partial input ('-', '1.', '') doesn't fight the committed value.
// Exported so the concept viewers (components/Thingtime/concepts) reuse the
// exact same number editor as the live tree.
export const NumberValueInput = (props: { value: number; onValueChange: (value: number) => void }) => {
	const { value, onValueChange } = props;

	const [draft, setDraft] = React.useState(String(value ?? 0));
	const focusedRef = React.useRef(false);

	React.useEffect(() => {
		if (!focusedRef.current && String(value) !== draft) {
			setDraft(String(value ?? 0));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	const commitText = React.useCallback(
		(text: string) => {
			const parsed = Number(text);
			if (text.trim() !== '' && !Number.isNaN(parsed) && parsed !== value) {
				onValueChange(parsed);
			}
		},
		[onValueChange, value]
	);

	const step = React.useCallback(
		(delta: number) => {
			// an emptied field steps from the committed value, not from
			// Number('') === 0
			const current = draft.trim() === '' ? NaN : Number(draft);
			const next = (Number.isNaN(current) ? value || 0 : current) + delta;
			setDraft(String(next));
			onValueChange(next);
		},
		[draft, value, onValueChange]
	);

	return (
		<Flex className="tt-number-input" alignItems="center" columnGap="7px">
			<Box
				as="input"
				value={draft}
				inputMode="decimal"
				aria-label="Number value"
				width={`${Math.max(String(draft).length, 1) + 3}ch`}
				minWidth="5ch"
				maxWidth="100%"
				paddingX="12px"
				paddingY="4px"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-sm, 9px)"
				background="var(--tt-card, #ffffff)"
				fontSize="inherit"
				fontFamily="inherit"
				outline="none"
				transition="border-color 0.15s ease, box-shadow 0.15s ease"
				_focus={{
					borderColor: 'var(--tt-faint, #b6b6c0)',
					boxShadow: '0 0 0 3px var(--tt-accent-tint, #fff5fa)'
				}}
				onFocus={() => {
					focusedRef.current = true;
				}}
				onBlur={(e) => {
					focusedRef.current = false;
					commitText((e.target as HTMLInputElement).value);
					setDraft(String(value ?? 0));
				}}
				onChange={(e) => {
					const text = (e.target as HTMLInputElement).value;
					setDraft(text);
					commitText(text);
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						(e.target as HTMLElement).blur?.();
					} else if (e.key === 'ArrowUp') {
						e.preventDefault();
						step(e.shiftKey ? 10 : 1);
					} else if (e.key === 'ArrowDown') {
						e.preventDefault();
						step(e.shiftKey ? -10 : -1);
					}
				}}
			/>
			<Flex as="button" type="button" aria-label="Decrease" title="Decrease (shift: −10)" {...numberStepButtonStyles} onClick={(e) => step(e.shiftKey ? -10 : -1)}>
				−
			</Flex>
			<Flex as="button" type="button" aria-label="Increase" title="Increase (shift: +10)" {...numberStepButtonStyles} onClick={(e) => step(e.shiftKey ? 10 : 1)}>
				+
			</Flex>
		</Flex>
	);
};

// join any with ThingtimeProps
type ThingtimeComponentProps = ThingtimeProps & any;
export const Thingtime = (args: ThingtimeComponentProps = {}) => {
	const props = {
		...args
	};
	const safeEmbed = props?.safeEmbed === true;

	const [thingtimeMachineNamespace, setThingtimeMachineNamespace] = React.useState(props?.thingtimeMachineNamespace || 'user');
	const [timelineNamespace, setTimelineNamespace] = React.useState('user');

	// if there's a props?.value set props?.thing to props?.value

	if (Object.hasOwnProperty.call(props, 'value')) {
		props.thing = props.value;
	}

	// TODO: Add a circular reference seen prop check
	// and add button to expand circular reference
	// up to 1 level deep

	const { append } = useThings();
	const lopu = useLopu();

	const { thingtime, setThingtime, getThingtime, loading, events } = useThingtime();

	const [uuid, setUuid] = React.useState(undefined);
	const didReportRenderRef = React.useRef(false);

	const [root, setRoot] = React.useState(props?.notRoot ? false : true);

	const [circular, setCircular] = React.useState(props?.circular);

	const thingtimeRef = React.useRef();

	const [showFullPathContext, setShowFullPathContext] = React.useState(false);
	// hover context on the key/property name itself (claude-todo 08 §5): shown
	// after a short hover intent so casual mouse travel doesn't flash tooltips
	const [showKeyPathContext, setShowKeyPathContext] = React.useState(false);
	const keyPathHoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const onKeyPathHoverEnter = React.useCallback(() => {
		clearTimeout(keyPathHoverTimerRef.current);
		keyPathHoverTimerRef.current = setTimeout(() => setShowKeyPathContext(true), 450);
	}, []);
	const onKeyPathHoverLeave = React.useCallback(() => {
		clearTimeout(keyPathHoverTimerRef.current);
		setShowKeyPathContext(false);
	}, []);
	React.useEffect(() => () => clearTimeout(keyPathHoverTimerRef.current), []);
	// the nearest ancestor's collapse-all/expand-all cascade — read via context
	// (not element props) so children mounting in the same commit as the
	// cascade update still see the fresh value
	const inheritedCollapsed = React.useContext(CollapseCascadeContext);
	const [isCollapsed, setIsCollapsed] = React.useState(Boolean(props?.collapsed ?? inheritedCollapsed));
	// set by collapse-all/expand-all: the mount default for this thing's children
	const [childrenDefaultCollapsed, setChildrenDefaultCollapsed] = React.useState<boolean | null>(null);

	// collapse events are scoped per tree root, so the same path shown in two
	// editor windows collapses independently
	const collapseScope = React.useMemo(
		() => props?.collapseScope || Math.random().toString(36).slice(2, 9),
		[props?.collapseScope]
	);

	const editValueRef = React.useRef({});

	const depth = React.useMemo(() => {
		return typeof props?.depth === 'number' ? props?.depth : 0;
	}, [props?.depth]);

	const [editModeState, setEditMode] = React.useState(props?.edit === true ? true : false);

	// Untrusted trees (other users' things mounted read-only in feeds / search /
	// profiles) must NEVER reach the raw editor: LongTextEditor's Editor.js renders
	// stored block data via innerHTML WITHOUT re-sanitizing, so an attacker's post
	// could execute script once a viewer toggled edit on a nested leaf. Pin editMode
	// false whenever untrusted so no toggle path (context menu, corner toggle, or a
	// props.edit sync) can mount the editor for content we don't trust — untrusted
	// content then only ever renders through the sanitizing read path. Trusted trees
	// are unchanged (editMode === editModeState).
	const editMode = props?.untrusted ? false : editModeState;

	// {} code view: same tree, more developer chrome (type icons, key counts,
	// [n] array indices, boolean pills). Propagates to children.
	const codeView = props?.codeView === true;

	// watch props.editMode and if it changes then set editMode to props.editMode
	React.useEffect(() => {
		if (typeof props?.edit === 'boolean') {
			setEditMode(props.edit);
		}
	}, [props?.edit]);

	const render = React.useMemo(() => {
		return !editMode || props?.render || false;
	}, [props?.render, editMode]);

	const width = React.useMemo(() => {
		if (props?.width) {
			return props?.width;
		}

		if (props?.w) {
			return props?.w;
		}

		if (render) {
			return '100%';
		}

		return '100%';
	}, [props?.width, props?.w, render]);

	const chakraChild = React.useMemo(() => {
		if (!editMode && props?.chakraChild) {
			return true;
		}

		return false;
	}, [editMode, props?.chakraChild]);

	const pl = React.useMemo(() => {
		if (!props.edit && chakraChild) {
			return [0];
		}

		return props?.pl || [4, 6];
	}, [props?.pl, editMode, chakraChild]);

	const pr = React.useMemo(() => {
		return props?.pr || (depth === 0 ? [4, 6] : 0);
	}, [props?.pr, depth]);

	const multiplyPl = React.useCallback(
		(num) => {
			return pl.map((p) => p * num);
		},
		[pl]
	);

	const propsRef = React.useRef(props);

	React.useEffect(() => {
		if (!didReportRenderRef.current) {
			didReportRenderRef.current = true;
			props?.onRendered?.();
		}
	}, []);

	React.useEffect(() => {
		propsRef.current = props;
	}, [props]);

	// will only run on the client
	React.useEffect(() => {
		setUuid(Math.random().toString(36).substring(7));
	}, []);

	const childrenRef = React.useRef([]);

	const [thingDep, setThingDep] = React.useState(childrenRef.current);

	const createDependancies = () => {
		// push all children into childrenRef.current

		try {
			window.meta.db['createDependancies'] = window.meta.db['createDependancies'] || 0;
			window.meta.db['createDependancies']++;
		} catch {}

		try {
			const values = Object.values(props?.thing);
			// if childrenRef.current does not shallow equal values then replace with array of values
			const valuesNotEqual =
				values?.length !== childrenRef.current?.length ||
				!values?.every?.((value, idx) => {
					return childrenRef.current[idx] === value;
				});
			if (valuesNotEqual) {
				childrenRef.current = values;
				setThingDep(childrenRef.current);
			}
		} catch {
			// nothing
		}
	};

	React.useEffect(() => {
		createDependancies();
	}, []);

	const path = React.useMemo(() => {
		return props?.path?.key || props?.path || '';
	}, [safeJoin(props?.path)]);

	const fullPath = React.useMemo(() => {
		const fullPathReturn = safeSplit(props?.fullPath || props?.path?.key || props?.path);

		if (TT_DEBUG) console.log('[tt] fullPathReturn', fullPathReturn);

		// store this thing in the global db — NEVER for untrusted (other users')
		// trees: this page-global would otherwise collect hostile feed payloads
		// (the "Massive security leak" the code already flags), and every feed
		// ThingView would clobber the same keys. Embed-SDK mounts (safeEmbed) live
		// on third-party pages, so they never touch the page global either.
		if (!safeEmbed && !props?.untrusted) {
			try {
				window.meta.things[safeJoin(fullPathReturn)] = props?.thing;
			} catch {
				// nothing
			}
		}

		return fullPathReturn;
	}, [safeJoin(props?.fullPath), safeJoin(props?.path), safeJoin(props?.path?.key), props?.thing, props?.untrusted, safeEmbed]);

	// TODO
	// attempt at making seedling button work with <Thingtime path argument only
	// const thingtimeThing = getThingtime(fullPath);
	// basically const value = React.useMemo
	const thing = React.useMemo(() => {
		// check if props has a thing prop and if not
		// use path to get thing from thingtime
		if (Object.hasOwnProperty.call(props, 'thing')) {
			return props?.thing;
		} else if (props?.path) {
			return getThingtime(fullPath);
		} else {
			return undefined;
		}
		// TODO
		// attempt at making seedling button work with <Thingtime path argument only

		// console.log('[tt] props.thing', props.thing);
		// console.log('[tt] fullPath', fullPath);
		// // if props has a key thing then return that
		// if (Object.hasOwnProperty.call(props, 'thing')) {
		//   return props.thing;
		// } else {
		//   return getThingtime(fullPath);
		// }
	}, [getThingtime, props?.thing, safeJoin(props?.path), uuid, childrenRef.current]);

	// Editor.js is a persisted datatype, not a transient decision based on
	// string length/focus. JSON-stringified Editor.js output is recognised for
	// clipboard/API compatibility and promoted to the native shape on edit.
	const editorJsDoc = React.useMemo(() => getEditorJsDoc(thing), [thing]);

	const chakra = React.useMemo(() => {
		// untrusted trees (other users' things mounted in feeds/search via
		// ThingView) must never reach the chakra path — it spreads thing.props
		// verbatim into Chakra components, which is only safe for data the
		// viewer authored themselves. Embed-SDK mounts (safeEmbed) render
		// JSON-only on third-party pages, so they are excluded for the same reason.
		if (safeEmbed || props?.untrusted) {
			return false;
		}

		return !editMode && typeof thing?.chakra === 'string' && thing?.chakra;
	}, [thing?.chakra, editMode, props?.untrusted, safeEmbed]);

	const parentPath = React.useMemo(() => {
		const parentPath = fullPath?.slice(0, -1);

		if (TT_DEBUG) console.log('[tt] parentPath', parentPath);

		if (!parentPath) {
			return 'thingtime';
		}

		return parentPath;
	}, [safeJoin(fullPath)]);

	const parent = React.useMemo(() => {
		return getThingtime(parentPath);
	}, [parentPath, getThingtime]);

	React.useEffect(() => {
		if (TT_DEBUG) console.log('[tt][useEffect][thingtime, props?.fullPath, childrenRef] props?.fullPath', props?.fullPath);
		createDependancies();
	}, [thingtime, safeJoin(props?.fullPath), childrenRef]);

	const seen = React.useMemo(() => {
		if (props?.seen instanceof Array) {
			if (props?.seen?.includes(thing)) {
				return props?.seen;
			} else if (typeof thing === 'object') {
				return [...props.seen, thing];
			}

			return props?.seen || [];
		}

		if (typeof thing === 'object') {
			return [thing];
		}

		return [];
	}, [props?.seen, thing]);

	const mode = React.useMemo(() => {
		return 'view';
	}, []);

	const validKeyTypes = React.useMemo(() => {
		return ['object', 'array'];
	}, []);

	const keys = React.useMemo(() => {
		if (editorJsDoc) {
			return [];
		}

		if (validKeyTypes?.includes(typeof thing)) {
			try {
				const keysRet = Object.keys(thing);
				return keysRet;
			} catch {
				// nothing
			}
		} else {
			return [];
		}
	}, [thing, thingDep, validKeyTypes, editorJsDoc]);

	const type = React.useMemo(() => {
		if (thing === null) {
			return 'undefined';
		}

		return typeof thing;
	}, [thing]);

	const typeIcon = React.useMemo(() => {
		const size = 7;
		if (editorJsDoc) {
			return (
				<Box as="span" aria-label="Editor.js" fontSize="18px" lineHeight="1">
					📝
				</Box>
			);
		} else if (thing instanceof Array) {
			return <Icon name="array" size={size}></Icon>;
		} else if (type === 'object') {
			return <Icon name="object" size={size}></Icon>;
		} else if (type === 'string') {
			return <Icon name="string" size={size}></Icon>;
		} else if (type === 'number') {
			return <Icon name="number" size={size}></Icon>;
		} else if (type === 'boolean') {
			return <Icon name="boolean" size={size}></Icon>;
		} else if (type === 'undefined') {
			return <Icon name="undefined" size={size}></Icon>;
		} else {
			return <Icon name="box" size={size}></Icon>;
		}
	}, [type, thing, editorJsDoc]);

	const valuePl = React.useMemo(() => {
		if (typeof props?.valuePl === 'number') {
			return props?.valuePl;
		}

		return props?.path ? [4, 6] : [0, 0];
	}, [props?.valuePl, safeJoin(props?.path)]);

	const renderableValue = React.useMemo(() => {
		if (chakraChild) {
			return null;
		}

		if (!props?.value && !props?.thing && !props?.path && props?.children) {
			return null;
		}

		if (type === 'string') {
			return <MagicInput value={thing} readonly></MagicInput>;
		} else if (type === 'number') {
			return thing;
		} else if (type === 'boolean') {
			if (codeView) {
				// developer view: literal value as a coloured pill
				return (
					<Box
						as="span"
						paddingX="8px"
						paddingY="2px"
						borderRadius="var(--tt-radius-xs, 7px)"
						background={thing ? 'var(--tt-positive-tint, #e4f6ea)' : 'var(--tt-surface-alt, #f5f5f7)'}
						color={thing ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-muted, #9a9aa6)'}
						fontFamily="var(--tt-font-mono, monospace)"
						fontSize="15px"
					>
						{thing ? 'true' : 'false'}
					</Box>
				);
			}

			return thing ? 'true' : 'false';
		} else if (type === 'object') {
			if (thing === null) {
				return 'null';
			}

			if (!keys?.length) {
				return 'Something!';
			}

			try {
				return JSON.stringify(thing, null, 2);
			} catch (err) {
				// console.error(
				//   "Caught error making renderableValue of thing",
				//   err,
				//   thing
				// )
				return (
					<Box cursor="pointer" onClick={() => setCircular(false)}>
						Click to Expand
					</Box>
				);
			}
		} else if (props?.children) {
			return;
		} else if (type === 'undefined') {
			return 'Imagine..';
		} else {
			return 'Something..';
		}
	}, [thing, thingDep, type, chakraChild, keys, codeView]);

	const renderChakra = React.useMemo(() => {
		if (!editMode && chakra && render) {
			return true;
		}

		return false;
	}, [chakra, editMode, render]);

	const keysToUse = React.useMemo(() => {
		if (renderChakra) {
			return ['children'];
		}

		return keys;
	}, [keys, renderChakra]);
	// const keysToUse = flattenedKeys
	const hasCollapsibleChildren = React.useMemo(() => {
		if (chakraChild || chakra) {
			return false;
		}

		if (circular) {
			return false;
		}

		if (!keysToUse?.length) {
			return false;
		}

		return typeof thing === 'object' && thing !== null;
	}, [chakraChild, chakra, circular, keysToUse, thing]);

	// if Thingtime object has "exec" then execute and set thing to returned data
	React.useEffect(() => {
		if (safeEmbed) return;

		(async () => {
			if (thing?.exec && typeof thing?.exec === 'function') {
				try {
					const execResult = await thing.exec(thing);
					if (execResult !== thing) {
						setThingtime(fullPath, execResult);
					}
				} catch (err) {
					console.error('Thingtime exec error', err);
				}
			}
		})();
	}, [safeEmbed, thingDep, safeJoin(fullPath), setThingtime]);

	const AtomicWrapper = React.useCallback((args) => {
		return (
			<Flex
				className={['atomic-wrapper', args?.className].filter(Boolean).join(' ')}
				position="relative"
				flexDirection="row"
				flexShrink={1}
				width="100%"
				paddingLeft={args?.pl || args?.paddingLeft}
				fontSize="20px"
				// whiteSpace="pre-line"
				border="none"
				whiteSpace="pre-wrap"
				wordBreak={args?.wordBreak || 'break-word'}
				// paddingY={2}
				// dangerouslySetInnerHTML={{ __html: renderableValue }}
				outline="none"
			>
				{args?.children}
			</Flex>
		);
	}, []);

	// make type any for this
	const [thingtimeChildren, setThingtimeChildren] = React.useState<any>(null);
	const [visibleKeyCount, setVisibleKeyCount] = React.useState(0);
	const [loadTargetCount, setLoadTargetCount] = React.useState(0);
	const [mountedChildrenCount, setMountedChildrenCount] = React.useState(0);

	React.useEffect(() => {
		if (!keysToUse?.length || circular) {
			setVisibleKeyCount(0);
			setLoadTargetCount(0);
			setMountedChildrenCount(0);
			return;
		}

		const keyGateLength = thingtime?.settings?.keyGateLength || 5;
		const shouldGate = keysToUse.length > keyGateLength;
		if (!shouldGate) {
			setVisibleKeyCount(keysToUse.length);
			setLoadTargetCount(keysToUse.length);
			setMountedChildrenCount(keysToUse.length);
			return;
		}

		const initialCount = Math.min(keyGateLength, keysToUse.length);
		setVisibleKeyCount((prev) => {
			if (prev > 0) {
				return Math.min(prev, keysToUse.length);
			}
			return initialCount;
		});
		setLoadTargetCount((prev) => (prev > 0 ? Math.min(prev, keysToUse.length) : initialCount));
		setMountedChildrenCount((prev) => Math.min(prev, keysToUse.length));
	}, [keysToUse, circular, thingDep, thing?.settings?.keyGateLength]);

	React.useEffect(() => {
		const keyGateLength = thingtime?.settings?.keyGateLength || 5;
		const shouldGate = keysToUse?.length > keyGateLength;
		if (!shouldGate) return;
		if (visibleKeyCount >= loadTargetCount) return;
		if (mountedChildrenCount < visibleKeyCount) return;

		setVisibleKeyCount((prev) => Math.min(prev + 1, loadTargetCount));
	}, [keysToUse, thingtime?.settings?.keyGateLength, visibleKeyCount, loadTargetCount, mountedChildrenCount]);

	const inner = React.useMemo(() => {
		let content = <AtomicWrapper paddingLeft={pl}>Imagine..</AtomicWrapper>;

		if (keysToUse?.length && !circular) {
			const keyGateLength = thingtime?.settings?.keyGateLength || 5;
			const shouldGate = keysToUse.length > keyGateLength;
			const visibleKeys = shouldGate ? keysToUse.slice(0, visibleKeyCount) : keysToUse;
			const isLoading = shouldGate && visibleKeyCount < keysToUse.length;
			const onChildRendered = shouldGate
				? () => {
						setMountedChildrenCount((prev) => prev + 1);
				  }
				: undefined;

			content = (
				<>
					{visibleKeys.map((key: any, idx) => {
						if (!key?.human) {
							key = {
								human: key,
								key: key
							};
						}

						const nextThing = thing[key?.key];

						const nextSeen = [...seen];

						if (typeof nextThing === 'object') {
							nextSeen.push(nextThing);
						}

						return (
							<Thingtime
								key={idx}
								seen={nextSeen}
								edit={editMode}
								codeView={codeView}
								render={render}
								untrusted={props?.untrusted}
								circular={seen?.includes?.(nextThing)}
								depth={depth + 1}
								parent={thing}
								notRoot
								fullPath={fullPath instanceof Array ? [...fullPath, key?.key] : fullPath + '.' + key?.key}
								path={key}
								chakraChild={chakra}
								thing={nextThing}
								// thing={{ infinite: { yes: true } }}
								valuePl={pl}
								onRendered={onChildRendered}
								collapseScope={collapseScope}
								// pre-padded containers (editor windows) slim the key
								// gutter for the whole tree, not just the root
								pathPl={props?.pathPl}
								safeEmbed={safeEmbed}
							></Thingtime>
						);
					})}
					{isLoading && (
						<AtomicWrapper paddingLeft={pl} className="thingtime-loading">
							<button
								type="button"
								style={{
									background: 'var(--tt-card, #ffffff)',
									border: '1px dashed var(--tt-faint, #b6b6c0)',
									borderRadius: 'var(--tt-radius-sm, 9px)',
									color: 'var(--tt-muted, #9a9aa6)',
									cursor: 'pointer',
									fontFamily: 'var(--tt-font-body, inherit)',
									fontSize: '12.5px',
									fontWeight: 600,
									padding: '5px 11px',
									transition: 'all 150ms ease'
								}}
								onClick={() => {
									setLoadTargetCount((prev) =>
										Math.min(Math.max(prev, visibleKeyCount) + (thingtime?.settings?.keyGateLength || 5), keysToUse.length)
									);
								}}
							>
								Load more
							</button>
						</AtomicWrapper>
					)}
				</>
			);
		}

		return content;
	}, [
		AtomicWrapper,
		pl,
		keysToUse,
		visibleKeyCount,
		circular,
		thing,
		thingtime?.settings?.keyGateLength,
		seen,
		editMode,
		codeView,
		render,
		depth,
		safeJoin(fullPath),
		chakra,
		safeEmbed,
		collapseScope,
		props?.pathPl,
		props?.untrusted
	]);

	React.useEffect(() => {
		if (editorJsDoc) {
			setThingtimeChildren(null);
			return;
		}

		if (type === 'object' && !circular) {
			if (chakra) {
				const ChakraComponent = Chakras[chakra];

				if (TT_DEBUG) console.log('Thingtime is chakra', fullPath, chakra);

				const rawChildren = thing?.rawChildren;

				try {
					if (ChakraComponent) {
						const VOID_ELEMENTS = [
							// Standard HTML strings
							'area',
							'base',
							'br',
							'col',
							'embed',
							'hr',
							'img',
							'input',
							'link',
							'meta',
							'param',
							'source',
							'track',
							'wbr',
							// Chakra UI DisplayNames (PascalCase)
							'Image',
							'Img',
							'Input',
							'Divider',
							'Icon',
							'Spinner',
							'Checkbox',
							'Radio',
							'Switch'
						];

						const isVoid =
							VOID_ELEMENTS.includes(ChakraComponent?.toLowerCase?.()) ||
							VOID_ELEMENTS.includes(ChakraComponent?.render?.displayName) ||
							VOID_ELEMENTS.includes(ChakraComponent?.displayName);

						if (TT_DEBUG) {
							console.log('Thingtime found ChakraComponent', fullPath, ChakraComponent);
							console.log('Thingtime found thing?.props', fullPath, thing?.props);
							console.log('Thingtime found isVoid', isVoid, ChakraComponent);
						}

						const ret = isVoid ? (
							<ChakraComponent {...(thing?.props || {})}></ChakraComponent>
						) : (
							<ChakraComponent {...(thing?.props || {})}>
								{rawChildren}
								{inner}
							</ChakraComponent>
						);

						// set thingtimeChildren to ret
						setThingtimeChildren(ret);
						return;
					}
				} catch {
					// chakra error
					console.error('Thingtime Chakra error', fullPath, chakra);
				}
			}

			// TODO: Is it safe to spread props
			// because having props as a dependency will cause a re-render every time

			if (props?.chakraChild) {
				// set thingtimeChildren to inner
				setThingtimeChildren(inner);
				return;
			}

			const wrapped = (
				<Flex
					className="nested-things"
					position="relative"
					flexDirection="column"
					rowGap={!chakra ? 9 : 0}
					// w={'500px'}
					// w={['200px', '500px']}
					maxWidth="100%"
					paddingLeft={valuePl}
					paddingY={!chakra && props?.path ? 4 : 0}
				>
					{inner}
				</Flex>
			);

			// set thingtimeChildren to wrapped
			setThingtimeChildren(wrapped);
			return;
		}
		setThingtimeChildren(null);
	}, [
		inner,
		circular,
		type,
		props?.chakraChild,
		safeJoin(props?.path),
		editMode,
		chakra,
		safeJoin(fullPath),
		render,
		depth,
		thing,
		thingDep,
		editorJsDoc,
		valuePl,
		pl
	]);

	const updateValue = React.useCallback(
		(args) => {
			const { value } = args;

			setThingtime(fullPath, value, {
				namespace: 'user'
			});
		},
		[safeJoin(fullPath), setThingtime]
	);

	const resetValue = React.useCallback(() => {
		updateValue({ value: null });
	}, [updateValue]);

	const onChangeType = React.useCallback(
		(args) => {
			const { type, wrap } = args;
			const typeKey = String(type?.key || '').toLowerCase();
			const currentTypeKey = editorJsDoc
				? 'editorjs'
				: thing instanceof Array
					? 'array'
					: thing === null || thing === undefined
						? 'any'
						: typeof thing;

			if (typeKey === currentTypeKey) return;

			if (typeKey === 'editorjs') {
				let source = '';
				// empty containers convert to a BLANK document (placeholder showing),
				// not a paragraph containing the literal "{}" / "[]"
				const isEmptyContainer =
					thing !== null &&
					typeof thing === 'object' &&
					(thing instanceof Array ? thing.length === 0 : Object.keys(thing).length === 0);
				if (typeof thing === 'string') {
					source = thing;
				} else if (thing !== null && thing !== undefined && !isEmptyContainer) {
					try {
						source = JSON.stringify(thing, null, 2) ?? String(thing);
					} catch {
						source = String(thing);
					}
				}
				if (source.length > EDITOR_JS_AUTO_DETECT_LIMITS.sourceLength) {
					lopu({
						title: 'Kept the value as-is',
						description: 'This value is too large to convert into an Editor.js document safely.',
						status: 'error'
					});
					return;
				}

				const next = editorJsDoc
					? { ...editorJsDoc, kind: 'rich-text' }
					: { kind: 'rich-text', blocks: textToBlocks(source) };
				if (!isEditorJsDocSafeToEdit(next)) {
					lopu({
						title: 'Kept the value as-is',
						description: 'This value would create an Editor.js document that is too large or deeply nested to edit safely.',
						status: 'error'
					});
					return;
				}
				updateValue({ value: next });
				return;
			}

			if (typeKey === 'string' && editorJsDoc) {
				if (!isEditorJsDocSafeToEdit(editorJsDoc)) {
					lopu({
						title: 'Kept the Editor.js document intact',
						description: 'This document is too large or deeply nested to flatten safely. Nothing was changed.',
						status: 'error'
					});
					return;
				}
				updateValue({ value: blocksToText(editorJsDoc.blocks) });
				return;
			}

			const typeValue = typeof type?.value === 'function' ? type?.value() : type?.value;

			if (type) {
				const wrapTarget = type?.wrap;
				if (wrap && wrapTarget) {
					const newValue = append({
						thing: typeValue[wrapTarget],
						value: thing
					});
					typeValue[wrapTarget] = newValue;
					if (typeValue) {
						updateValue({ value: typeValue });
					}
				} else {
					updateValue({ value: typeValue });
				}
			}
		},
		[updateValue, thing, editorJsDoc, append, safeJoin(fullPath), lopu]
	);

	const onWrapType = React.useCallback(
		(type) => {
			// nothing
		},
		[updateValue]
	);

	const deleteValue = React.useCallback(() => {
		// array parents stay arrays — spreading them into an object would
		// corrupt the parent shape
		if (parent instanceof Array) {
			const index = Number(path);
			const clone = parent.filter((item, idx) => idx !== index);

			setThingtime(parentPath, clone, {
				namespace: 'user'
			});
			return;
		}

		// use parent path to clone parent object but without this key
		const clone = { ...parent };

		delete clone[path];

		setThingtime(parentPath, clone, {
			namespace: 'user'
		});
	}, [path, parent, parentPath, setThingtime]);

	const atomicValue = React.useMemo(() => {
		const debug: any = {};
		if (TT_DEBUG) {
			console.log('[tt][Thingtime.tsx][atomicValue][debug]', debug);
			// log renderableValue
			console.log('renderableValue', props?.debugId, renderableValue);
		}
		if (editorJsDoc) {
			debug.editorJs = true;
			return (
				<AtomicWrapper paddingLeft={pl} className="editorjs-atomic-wrapper">
					{editMode ? (
						<LongTextEditor value={editorJsDoc} onValueChange={(next) => updateValue({ value: next })} />
					) : (
						<Box width="100%" minWidth={0} paddingY={2}>
							<RichTextBlocks blocks={editorJsDoc.blocks} />
						</Box>
					)}
				</AtomicWrapper>
			);
		}

		if (renderableValue === null) {
			debug.noRenderableValue = true;
			return null;
		}

		if (editMode) {
			if (TT_DEBUG) console.log('[tt] atomicVaulue type', type);
			if (type === 'boolean') {
				debug.boolean = true;
				return (
					<AtomicWrapper paddingLeft={pl} className="boolean-atomic-wrapper">
						<Box
							onClick={(e) => {
								e?.preventDefault?.();
								e?.stopPropagation?.();
								// cancel bubble
								e?.nativeEvent?.stopImmediatePropagation?.();
								setTimeout(() => {
									updateValue({ value: !thing });
								}, 1);
							}}
						>
							<Switch isChecked={thing}></Switch>
						</Box>
					</AtomicWrapper>
				);
			}

			if (type === 'number') {
				debug.number = true;
				return (
					<AtomicWrapper paddingLeft={pl} className="number-atomic-wrapper">
						<NumberValueInput value={thing} onValueChange={(next) => updateValue({ value: next })} />
					</AtomicWrapper>
				);
			}

			if (type === 'string') {
				debug.string = true;

				return (
					<AtomicWrapper paddingLeft={pl} className="string-atomic-wrapper">
						<MagicInput value={thing} placeholder="Imagine.." onValueChange={updateValue}></MagicInput>
						{/* <Box
              ref={contentEditableRef}
              width="100%"
              border="none"
              outline="none"
              contentEditable={true}
              dangerouslySetInnerHTML={{ __html: contentEditableThing }}
              onInput={(value) => {
                const innerText = value?.target?.innerText
                if (typeof innerText === "string") {
                  const time = Date.now()
                  editValueRef.current[time] = innerText
                  updateValue({ value: innerText })
                }
              }}
            ></Box> */}
					</AtomicWrapper>
				);
			}

			if (type === 'undefined') {
				debug.undefined = true;
				debug.fullPath = fullPath;
				return (
					<AtomicWrapper paddingLeft={pl}>
						{/* TODO: Implement UI-less commander */}
						<CommanderV1
							// rainbow
							id={uuid}
							pathPrefix={fullPath}
							placeholder="Imagine.."
							// onValueChange={updateValue}
						></CommanderV1>
					</AtomicWrapper>
				);
			}
		}

		return (
			<AtomicWrapper paddingLeft={pl} className="default-atomic-wrapper">
				{renderableValue}
			</AtomicWrapper>
		);
	}, [renderableValue, editorJsDoc, pl, type, safeJoin(fullPath), uuid, AtomicWrapper, editMode, thing, thingDep, updateValue]);

	const contextMenu = (
		<Flex position="absolute" top={0} right={0} paddingRight={4} userSelect="none">
			Settings
		</Flex>
	);

	const [showContextMenu, setShowContextMenu] = React.useState(false);

	const humanPath = React.useMemo(() => {
		if (typeof props?.path === 'string') {
			return props?.path;
		}

		return props?.path?.human || '';
	}, [safeJoin(props?.path)]);

	const renderedPath = React.useMemo(() => {
		// code view labels array elements by index, [0] style
		const codeHumanPath = codeView && props?.parent instanceof Array ? `[${humanPath}]` : humanPath;

		if (editMode) {
			return codeHumanPath;
		}

		if (humanPath?.includes?.('hidden')) {
			return null;
		}

		if (humanPath?.includes?.('unique')) {
			// take only path from before the string unique
			return humanPath.split?.('unique')?.[0];
		}

		return codeHumanPath;
	}, [humanPath, editMode, codeView, props?.parent]);

	// updatePath updateKey updatePathname updatePropName
	const updatePath = React.useCallback(
		(args) => {
			if (typeof args?.value === 'string') {
				try {
					const parentKeys = Object.keys(parent);
					// the parent holds this thing under the path's LAST segment — a
					// root mounted at a dotted path (an editor window on
					// tmp.<session>.New Thing) must match 'New Thing', not the full
					// dotted string, or the rename silently no-ops
					const currentKey = safeSplit(path).pop?.() ?? path;

					// paths are dot-joined strings, so a key containing '.' is
					// unaddressable — it would store as one literal key but every
					// string binding (editor windows, the composer draft) would
					// resolve it as two segments and go blank. Refuse the rename;
					// also skip when this binding is already stale (key not in
					// parent) so no rewrite or rename event fires for a no-op.
					if (args.value.includes('.') || !parentKeys.includes(currentKey)) {
						return;
					}
					// create new object with new key order
					const newObject = {};

					parentKeys.forEach((key) => {
						if (key === currentKey) {
							newObject[args.value] = parent[key];
							return;
						}

						newObject[key] = parent[key];
					});
					// set new object
					setThingtime(parentPath, newObject, {
						namespace: thingtimeMachineNamespace
					});

					// anything bound to this path by STRING (editor windows, the
					// composer's draft binding) must follow the rename or it points
					// at a key that no longer exists — announce it on the bus
					events?.next?.({
						type: 'path-renamed',
						from: safeJoin(fullPath),
						to: safeJoin([...safeSplit(parentPath), args.value])
					});

					if (!thingtimeRef?.current) {
						return;
					}

					// focus next input
					const focusableNodeList = (thingtimeRef?.current as HTMLElement)?.querySelectorAll?.('.magic-input-focusable');

					// convert focusable to array
					const focusable = Array.from(focusableNodeList);

					const pathMagicInputFocusable = pathRef?.current?.querySelector?.('.magic-input-focusable');

					const nearestMagicInput: unknown = focusable?.find((input) => {
						if (input !== pathMagicInputFocusable) {
							return true;
						}

						return false;
					});

					if (nearestMagicInput) {
						(nearestMagicInput as HTMLElement)?.focus?.();
					}
				} catch (err) {
					console.error('Thingtime:657 Something went wrong reassigning path', err);
				}
			}
		},
		[parent, path, parentPath, setThingtime, fullPath, events]
	);

	const pathRef = React.useRef(null);

	const pathDom = React.useMemo(() => {
		if (chakraChild) {
			return <></>;
		}

		// composer draft roots hide their key ("New Thing") — the value IS the
		// editor; the hover/hold context trigger still renders (see the
		// hideRootPath gate on the thingPathDom actions row below)
		if (props?.hideRootPath) {
			return null;
		}

		if (renderedPath) {
			return (
				<>
					<MagicInput
						ref={pathRef}
						whiteSpace="pre"
						value={renderedPath}
						readonly={!editMode}
						onEnter={updatePath}
						chakras={{
							maxWidth: '100%',
							paddingLeft: props?.pathPl || pl,
							color: 'var(--tt-muted, #9a9aa6)',
							fontFamily: 'mono',
							fontSize: '12px',
							wordBreak: 'break-all'
						}}
					></MagicInput>
				</>
			);
		}
		// updatePath MUST be a dep: it closes over `parent`, which is undefined on
		// a root's first render when the store seeds after mount (the composer's
		// draft). Pinning the mount-time closure makes every later rename throw.
	}, [renderedPath, pl, chakraChild, editMode, props?.pathPl, props?.hideRootPath, updatePath]);

	// Leaf values can collapse to their property path just like nested things
	// collapse to their path + summary badge. A path is required so a root-level
	// atomic Thing can never collapse into a completely blank row.
	const hasCollapsibleAtomicValue = Boolean(
		renderedPath &&
			!chakraChild &&
			!chakra &&
			!circular &&
			!props?.children &&
			(thing === null || typeof thing !== 'object')
	);
	const hasCollapsibleContent = hasCollapsibleChildren || hasCollapsibleAtomicValue;
	// Render from the derived capability as well as state. This avoids a blank
	// frame when an inherited collapse-all reaches a pathless/non-collapsible
	// value before the cleanup effect resets its stale collapse state.
	const isContentCollapsed = isCollapsed && hasCollapsibleContent;
	const collapseActionLabel = `${isContentCollapsed ? 'Expand' : 'Collapse'} ${renderedPath || safeJoin(fullPath)}`.trim();

	React.useEffect(() => {
		if (!hasCollapsibleContent && isCollapsed) {
			setIsCollapsed(false);
		}
	}, [hasCollapsibleContent, isCollapsed]);

	// context-menu View verbs. The -all variants broadcast over the events bus;
	// this node hears its own event too (delivery is synchronous), and every
	// mounted node in the same scope whose path matches collapses/expands
	const applyCollapse = React.useCallback(
		(command: 'collapse' | 'expand' | 'collapse-all' | 'expand-all') => {
			if (command === 'collapse' || command === 'expand') {
				setIsCollapsed(command === 'collapse');
				return;
			}

			events.next({
				type: 'thingtime-collapse',
				scope: collapseScope,
				path: safeJoin(fullPath),
				collapsed: command === 'collapse-all'
			});
		},
		[events, collapseScope, safeJoin(fullPath)]
	);

	React.useEffect(() => {
		const self = safeJoin(fullPath);

		const subscription = events.subscribe((event: any) => {
			if (event?.type !== 'thingtime-collapse' || event.scope !== collapseScope) {
				return;
			}

			const target = typeof event.path === 'string' ? event.path : '';

			if (self !== target && !(target && self.startsWith(`${target}.`))) {
				return;
			}

			// mount default for children rendered later + live state now
			setChildrenDefaultCollapsed(!!event.collapsed);

			if (hasCollapsibleContent) {
				setIsCollapsed(!!event.collapsed);
			}
		});

		return () => {
			subscription?.unsubscribe?.();
		};
	}, [events, collapseScope, safeJoin(fullPath), hasCollapsibleContent]);

	const handleMouseEvent = React.useCallback(
		(e) => {
			const target = e?.target;
			// extract uuid from className
			const className = target?.className;
			if (className?.includes(uuid?.current)) {
				setShowContextMenu(e?.type === 'mouseenter');
			}
		},
		[uuid]
	);

	const addNewChild = React.useCallback(
		(args?: any) => {
			const { type } = args;
			const newChild = typeof type?.value === 'function' ? type?.value() : type?.value || null;

			if (TT_DEBUG) console.log('[tt] newChild', newChild);

			const thingIsArray = thing instanceof Array;

			if (TT_DEBUG) console.log('[tt] thingIsArray', thingIsArray);

			if (thingIsArray) {
				// add new child to array
				const newValue = [...thing, newChild];
				setThingtime(fullPath, newValue, {
					namespace: thingtimeMachineNamespace
				});
				return;
			}

			const newChildBasePath = 'New Value';
			// find increment that thing doesn't already have New Value N+1
			let increment = 0;
			let newPath = newChildBasePath;
			// TODO: Change so we aren't limiting new properties from New Value 1-999
			// Maybe use a random natural language name generator
			while (Object.hasOwnProperty.call(thing, newPath) && increment <= 999) {
				increment++;
				newPath = newChildBasePath + ' ' + increment;
			}

			const newChildPath = newPath;
			const newChildFullPath = [...safeSplit(fullPath), newChildPath];

			if (TT_DEBUG) console.log('[tt] newChildFullPath', newChildFullPath);

			// create new child on thing using setThingtime
			setThingtime(newChildFullPath, newChild, {
				namespace: thingtimeMachineNamespace
			});
		},
		[safeJoin(fullPath), setThingtime, thing]
	);

	const [showContextIcon, setShowContextIcon] = React.useState(false);
	const [showNewContextIcon, setShowNewContextIcon] = React.useState(false);

	// should be absolute last
	React.useEffect(() => {
		// never register untrusted (other users') trees, or embed-SDK mounts living
		// on a third-party page, in this page global
		if (safeEmbed || props?.untrusted) return;
		try {
			window.meta.things[uuid] = {
				thing: props?.thing,
				props,
				state: {
					chakra,
					chakraChild,
					circular,
					depth,
					fullPath,
					parent,
					parentPath,
					path
				}
			};
		} catch {
			// nothing
		}
	}, [thing, props, uuid, chakra, chakraChild, circular, depth, safeEmbed, safeJoin(fullPath), parent, parentPath, path]);

	if (chakra || chakraChild) {
		return thingtimeChildren;
	}
	// log chakra and chakraChild
	return (
		<Safe {...props} disabled={safeEmbed} depth={depth} uuid={uuid}>
			<Flex
				ref={thingtimeRef}
				position="relative"
				// width="500px"
				flexDirection="column"
				// rowGap={2}
				width={width}
				maxWidth="100%"
				// marginTop={3}
				paddingRight={pr}
				// minW={depth === 1 ? '120px' : null}
				onMouseEnter={handleMouseEvent}
				onMouseLeave={handleMouseEvent}
				{...(props.chakras || {})}
				className={`thing uuid-${uuid} edit-${editMode ? 'true' : 'false'}`}
				data-path={typeof props?.path === 'string' ? props.path : props?.path?.key || undefined}
			>
				{/* {uuid?.current} */}
				{!chakraChild && !chakra && (
					<Flex className="thingHeader" position="relative" flexDirection="row">
						<Flex
							className="thingHeaderMouseCapture"
							position="relative"
							alignItems="center"
							flexDirection="row"
							marginRight="auto"
							onMouseEnter={() => setShowContextIcon(true)}
							onMouseLeave={() => setShowContextIcon(false)}
						>
							<Flex
								className="thingPathDom-raw"
								data-tt-zone="key"
								position="relative"
								onMouseEnter={onKeyPathHoverEnter}
								onMouseLeave={onKeyPathHoverLeave}
							>
								{/* full dotted path on key hover — same treatment as the
								add-child seedling row's context window */}
								{showKeyPathContext && !!safeJoin(fullPath) && (
									<Flex
										position="absolute"
										bottom="100%"
										left={0}
										zIndex={2}
										color="var(--tt-muted, #9a9aa6)"
										fontFamily="mono"
										fontSize="12px"
										background="var(--tt-surface-alt, #f5f5f7)"
										borderRadius="var(--tt-radius-xs, 7px)"
										pointerEvents="none"
										whiteSpace="nowrap"
										maxWidth="min(80vw, 560px)"
										overflow="hidden"
										textOverflow="ellipsis"
										display="block"
										paddingX={3}
										paddingY={1}
									>
										{safeJoin(fullPath)}
									</Flex>
								)}
								{pathDom}
							</Flex>
							{(editMode || codeView) && !props?.hideRootPath && (
								<Box
									className="thingTypeIcon"
									// marginTop={-3}
									marginTop={-1}
									paddingLeft={1}
									opacity={0.5}
									cursor="pointer"
								>
									{typeIcon}
								</Box>
							)}
							{codeView && hasCollapsibleChildren && !isContentCollapsed && (
								<Flex
									className="thingKeyCount"
									alignItems="center"
									marginTop={-1}
									marginLeft={2}
									paddingX="8px"
									paddingY="1px"
									background="var(--tt-surface-alt, #f5f5f7)"
									borderRadius="999px"
									color="var(--tt-muted, #9a9aa6)"
									fontFamily="var(--tt-font-mono, monospace)"
									fontSize="11px"
									whiteSpace="nowrap"
									userSelect="none"
								>
									{thing instanceof Array ? `${thing.length} item${thing.length === 1 ? '' : 's'}` : `${keys?.length || 0} key${keys?.length === 1 ? '' : 's'}`}
								</Flex>
							)}
							{/* collapsed children fold up into an inline badge on the key
							row (no indented placeholder row) — click to expand */}
							{hasCollapsibleChildren && isContentCollapsed && (
								<Flex
									className="thingCollapsedBadge"
									as="button"
									type="button"
									title="Expand"
									aria-label="Expand collapsed children"
									alignItems="center"
									marginLeft={2}
									paddingX="8px"
									paddingY="1px"
									background="var(--tt-surface-alt, #f5f5f7)"
									borderRadius="999px"
									color="var(--tt-muted, #9a9aa6)"
									fontFamily="var(--tt-font-mono, monospace)"
									fontSize="11px"
									whiteSpace="nowrap"
									userSelect="none"
									cursor="pointer"
									transition="background 0.15s ease, color 0.15s ease"
									_hover={{ background: 'var(--tt-surface-hover, #ececee)', color: 'var(--tt-ink, #16161a)' }}
									onClick={(e) => {
										e?.preventDefault?.();
										e?.stopPropagation?.();
										setIsCollapsed(false);
									}}
								>
									{thing instanceof Array ? `[…] ${thing.length}` : `{…} ${keys?.length || 0}`}
								</Flex>
							)}
							{(pathDom || props?.hideRootPath) && (
								<Flex className="thingPathDom" flexDirection="row" alignItems="center" columnGap="2px" paddingLeft={1}>
									{/* hover quick actions: collapse/expand beside the context
									icon (the row's "double whammy") — always in layout so
									nothing shifts, revealed on row hover */}
									{hasCollapsibleContent && (
										<Flex
											className="thingCollapseQuick"
											as="button"
											type="button"
											aria-label={collapseActionLabel}
											aria-expanded={!isContentCollapsed}
											title={collapseActionLabel}
											alignItems="center"
											justifyContent="center"
											width="20px"
											height="20px"
											flexShrink={0}
											borderRadius="var(--tt-radius-xs, 7px)"
											color="var(--tt-muted, #9a9aa6)"
											cursor="pointer"
											opacity={showContextIcon ? 1 : 0}
											transition="opacity 0.15s ease, background 0.15s ease, color 0.15s ease"
											sx={{ '@media (hover: none), (max-width: 48em)': { opacity: 1, width: '44px', height: '44px' } }}
											_hover={{ background: 'var(--tt-surface-hover, #ececee)', color: 'var(--tt-ink, #16161a)' }}
											_focusVisible={{ opacity: 1, outline: '2px solid var(--tt-accent, hotpink)', outlineOffset: '-2px' }}
											onClick={(e) => {
												e?.preventDefault?.();
												e?.stopPropagation?.();
												setIsCollapsed((prev) => !prev);
											}}
										>
											<Icon name={isContentCollapsed ? '▸' : '▾'} lucide={isContentCollapsed ? 'chevron-right' : 'chevron-down'} size="14px" />
										</Flex>
									)}
									<ThingContextMenuTrigger
										editMode={editMode}
										setEditMode={setEditMode}
										transition="all 0.2s ease-in-out"
										opacity={showContextIcon ? 1 : 0}
										// 11px emoji ≈ 13px lucide — the same optical size as
										// the editor toolbar's chrome icons
										iconSize={11}
										uuid={uuid}
										fullPath={fullPath}
										path={path}
										parent={parent}
										parentPath={parentPath}
										thing={thing}
										thingType={type}
										readonly={!editMode}
										collapsible={hasCollapsibleContent}
										collapsibleChildren={hasCollapsibleChildren}
										collapsed={isContentCollapsed}
										onCollapse={applyCollapse}
										onType={onChangeType}
										onDelete={deleteValue}
										contextTargetRef={thingtimeRef}
									></ThingContextMenuTrigger>
								</Flex>
							)}
						</Flex>
					</Flex>
				)}
				{/* {showContextMenu && contextMenu} */}
				{/* this value will show in a few cases */}
				{/* Basic types like String, Number, etc.. non-object values */}
				{/* it will also show if the Thing has standard React children */}
				{/* Editor.js owns floating toolbar/popover UI, so its datatype must
				remain overflow-visible. Other atomic values keep horizontal auto
				overflow (not scroll) to avoid a permanent stray scrollbar track. */}
				{!loading && !isContentCollapsed && !thingtimeChildren && atomicValue && (
					<Box
						className="atomicValue"
						data-tt-zone="value"
						width="100%"
						overflowX={editorJsDoc ? 'visible' : 'auto'}
						overflowY={editorJsDoc ? 'visible' : undefined}
					>
						{atomicValue}
					</Box>
				)}
				{/* render any normal React children as well */}
				{render && props?.children ? props.children : null}
				{/* render thingtime children */}
				{!loading && thingtimeChildren && !isContentCollapsed && (
					<Box className="thingtimeChildren" flexGrow={0} flexShrink={1} width={render ? '100%' : ''}>
						<CollapseCascadeContext.Provider value={childrenDefaultCollapsed ?? inheritedCollapsed}>
							{thingtimeChildren}
						</CollapseCascadeContext.Provider>
						{!render && type === 'object' && (
							<Flex
								position="relative"
								width="100%"
								paddingLeft={multiplyPl(2)}
								opacity={editMode ? 1 : 0}
								cursor="pointer"
								transition="all 0.2s ease-out"
								onClick={addNewChild}
								onMouseEnter={() => {
									setShowFullPathContext(true);
									setShowNewContextIcon(true);
								}}
								onMouseLeave={() => {
									setShowFullPathContext(false);
									setShowNewContextIcon(false);
								}}
								paddingY={2}
							>
								<Flex
									position="absolute"
									bottom="100%"
									left={0}
									display={showFullPathContext ? 'flex' : 'none'}
									color="var(--tt-muted, #9a9aa6)"
									fontFamily="mono"
									fontSize="12px"
									background="var(--tt-surface-alt, #f5f5f7)"
									borderRadius="var(--tt-radius-xs, 7px)"
									pointerEvents="none"
									paddingX={3}
									paddingY={1}
								>
									{safeJoin(fullPath)}
								</Flex>
								<Icon
									_focus={{
										outline: 'none !important',
										textShadow: '0px 0px 10px var(--tt-positive, #2f8f4f)'
									}}
									onKeyDown={(e) => {
										if (e?.key === 'Enter') {
											addNewChild();
										}
									}}
									tabIndex={0}
									size={10}
									name="seedling"
								></Icon>
								<Flex
									marginLeft={2}
									onClick={(e) => {
										e?.preventDefault();
										e?.stopPropagation();
										e?.nativeEvent?.stopImmediatePropagation();
									}}
								>
									<ThingContextMenuTrigger
										variant="new-child"
										editMode={editMode}
										setEditMode={setEditMode}
										transition="all 0.2s ease-in-out"
										opacity={showNewContextIcon ? 1 : 0}
										uuid={uuid}
										iconSize={10}
										fullPath={fullPath}
										thingType={type}
										readonly={!editMode}
										onAddChild={addNewChild}
									></ThingContextMenuTrigger>
								</Flex>

								{/* <Icon size={7} name="plus"></Icon>
          <Icon size={7} name="plus"></Icon> */}
							</Flex>
						)}
					</Box>
				)}
			</Flex>
		</Safe>
	);
};;

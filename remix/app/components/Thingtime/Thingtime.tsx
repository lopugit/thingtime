import React from 'react';
import ContentEditable from 'react-contenteditable';
import * as Chakras from '@chakra-ui/react';
import {
	Box,
	Center,
	Flex,
	Input,
	NumberDecrementStepper,
	NumberIncrementStepper,
	NumberInput,
	NumberInputField,
	NumberInputStepper,
	Select,
	Spinner,
	Switch,
	Textarea
} from '@chakra-ui/react';

import { CommanderV1 } from '../Commander/CommanderV1Deprecated';
import { CommanderV2 } from '../Commander/CommanderV2';
// import { Magic } from "../Commander/Magic"
import { Icon } from '../Icon/Icon';
import { MagicInput } from '../MagicInput/MagicInput';
import { Safe } from '../Safety/Safe';
import { SettingsMenu } from './SettingsMenu';
import { useThingtime } from './useThingtime';

import { useThings } from '~/hooks/useThings';
import { getThing } from '~/smarts';
import { safeJoin, safeSplit } from '~/utils';

type ThingtimeProps = {
	debugId?: string;
	thingtimeMachineNamespace?: string;
};

// join any with ThingtimeProps
type ThingtimeComponentProps = ThingtimeProps & any;
export const Thingtime = (args: ThingtimeComponentProps = {}) => {
	const props = {
		...args
	};

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

	const { thingtime, setThingtime, getThingtime, loading, events } = useThingtime();

	const [uuid, setUuid] = React.useState(undefined);
	const didReportRenderRef = React.useRef(false);

	const [root, setRoot] = React.useState(props?.notRoot ? false : true);

	const [circular, setCircular] = React.useState(props?.circular);

	const thingtimeRef = React.useRef();

	const [showFullPathContext, setShowFullPathContext] = React.useState(false);
	const [isCollapsed, setIsCollapsed] = React.useState(Boolean(props?.collapsed));

	const editValueRef = React.useRef({});

	const depth = React.useMemo(() => {
		return typeof props?.depth === 'number' ? props?.depth : 0;
	}, [props?.depth]);

	const [editMode, setEditMode] = React.useState(props?.edit === true ? true : false);

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

		console.log('[tt] fullPathReturn', fullPathReturn);

		// store this thing in the global db
		// Massive security leak issue
		try {
			window.meta.things[safeJoin(fullPathReturn)] = props?.thing;
		} catch {
			// nothing
		}

		return fullPathReturn;
	}, [safeJoin(props?.fullPath), safeJoin(props?.path), safeJoin(props?.path?.key), props?.thing]);

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

	const chakra = React.useMemo(() => {
		return !editMode && typeof thing?.chakra === 'string' && thing?.chakra;
	}, [thing?.chakra, editMode]);

	const parentPath = React.useMemo(() => {
		const parentPath = fullPath?.slice(0, -1);

		console.log('[tt] parentPath', parentPath);

		if (!parentPath) {
			return 'thingtime';
		}

		return parentPath;
	}, [safeJoin(fullPath)]);

	const parent = React.useMemo(() => {
		return getThingtime(parentPath);
	}, [parentPath, getThingtime]);

	React.useEffect(() => {
		console.log('[tt][useEffect][thingtime, props?.fullPath, childrenRef] props?.fullPath', props?.fullPath);
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
	}, [thing, thingDep, validKeyTypes]);

	const type = React.useMemo(() => {
		if (thing === null) {
			return 'undefined';
		}

		return typeof thing;
	}, [thing]);

	const typeIcon = React.useMemo(() => {
		const size = 7;
		if (thing instanceof Array) {
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
	}, [type, thing]);

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
	}, [thing, thingDep, type, chakraChild, keys]);

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

	React.useEffect(() => {
		if (!hasCollapsibleChildren && isCollapsed) {
			setIsCollapsed(false);
		}
	}, [hasCollapsibleChildren, isCollapsed]);

	// if Thingtime object has "exec" then execute and set thing to returned data
	React.useEffect(() => {
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
	}, [thingDep, safeJoin(fullPath), setThingtime]);

	const AtomicWrapper = React.useCallback((args) => {
		return (
			<Flex
				className="atomic-wrapper"
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
								render={render}
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
		render,
		depth,
		safeJoin(fullPath),
		chakra
	]);

	React.useEffect(() => {
		if (type === 'object' && !circular) {
			if (chakra) {
				const ChakraComponent = Chakras[chakra];

				console.log('Thingtime is chakra', fullPath, chakra);

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

						console.log('Thingtime found ChakraComponent', fullPath, ChakraComponent);
						console.log('Thingtime found thing?.props', fullPath, thing?.props);
						console.log('Thingtime found isVoid', isVoid, ChakraComponent);

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
		[updateValue, thing, append, safeJoin(fullPath)]
	);

	const onWrapType = React.useCallback(
		(type) => {
			// nothing
		},
		[updateValue]
	);

	const deleteValue = React.useCallback(() => {
		// use parent path to clone parent object but without this key
		const clone = { ...parent };

		delete clone[path];

		setThingtime(parentPath, clone, {
			namespace: 'user'
		});
	}, [path, parent, parentPath, setThingtime]);

	const atomicValue = React.useMemo(() => {
		const debug: any = {};
		console.log('[tt][Thingtime.tsx][atomicValue][debug]', debug);
		// log renderableValue
		console.log('renderableValue', props?.debugId, renderableValue);
		if (renderableValue === null) {
			debug.noRenderableValue = true;
			return null;
		}

		if (editMode) {
			console.log('[tt] atomicVaulue type', type);
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
				// this helps render numbers better
				const numberPxLength = thing?.toString()?.length * 13 + 30;
				return (
					<AtomicWrapper paddingLeft={pl} className="number-atomic-wrapper">
						<Flex>
							<NumberInput
								alignItems="center"
								justifyContent="center"
								onChange={(value) => {
									// setTimeout(() => {
									try {
										const number = Number(value);
										updateValue({ value: number });
									} catch {
										// something went wrong casting to number
									}
									// }, 1);
								}}
								value={thing}
							>
								<NumberInputField width={numberPxLength + 'px'} />
								<NumberInputStepper transform="scale(0.9)">
									<NumberIncrementStepper
									// transform="scale(0.7)"
									/>
									<NumberDecrementStepper
									// transform="scale(0.7)"
									/>
								</NumberInputStepper>
							</NumberInput>
						</Flex>
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
	}, [renderableValue, pl, type, safeJoin(fullPath), uuid, AtomicWrapper, editMode, thing, thingDep, updateValue]);

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
		if (editMode) {
			return humanPath;
		}

		if (humanPath?.includes?.('hidden')) {
			return null;
		}

		if (humanPath?.includes?.('unique')) {
			// take only path from before the string unique
			return humanPath.split?.('unique')?.[0];
		}

		return humanPath;
	}, [humanPath, editMode]);

	// updatePath updateKey updatePathname updatePropName
	const updatePath = React.useCallback(
		(args) => {
			if (typeof args?.value === 'string') {
				try {
					const parentKeys = Object.keys(parent);
					// create new object with new key order
					const newObject = {};

					parentKeys.forEach((key) => {
						if (key === path) {
							newObject[args.value] = parent[key];
							return;
						}

						newObject[key] = parent[key];
					});
					// set new object
					setThingtime(parentPath, newObject, {
						namespace: thingtimeMachineNamespace
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
		[parent, path, parentPath, setThingtime]
	);

	const pathRef = React.useRef(null);

	const pathDom = React.useMemo(() => {
		if (chakraChild) {
			return <></>;
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
	}, [renderedPath, pl, chakraChild, editMode, props?.pathPl]);

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

			console.log('[tt] newChild', newChild);

			const thingIsArray = thing instanceof Array;

			console.log('[tt] thingIsArray', thingIsArray);

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

			console.log('[tt] newChildFullPath', newChildFullPath);

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
	}, [thing, props, uuid, chakra, chakraChild, circular, depth, safeJoin(fullPath), parent, parentPath, path]);

	if (chakra || chakraChild) {
		return thingtimeChildren;
	}
	// log chakra and chakraChild
	return (
		<Safe {...props} depth={depth} uuid={uuid}>
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
				data-path={props?.path}
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
							{hasCollapsibleChildren && (
								<Flex
									className="thingCaretToggle"
									alignItems="center"
									justifyContent="center"
									marginRight={2}
									cursor="pointer"
									userSelect="none"
									opacity={0.8}
									tabIndex={0}
									position="absolute"
									left={-4}
									onClick={(e) => {
										e?.preventDefault?.();
										e?.stopPropagation?.();
										e?.nativeEvent?.stopImmediatePropagation?.();
										setIsCollapsed((prev) => !prev);
									}}
									onKeyDown={(e) => {
										if (e?.key === 'Enter' || e?.key === ' ') {
											e?.preventDefault?.();
											setIsCollapsed((prev) => !prev);
										}
									}}
								>
									<Box color="var(--tt-faint, #b6b6c0)" fontSize="12px" lineHeight="1">
										{isCollapsed ? '▸' : '▾'}
									</Box>
								</Flex>
							)}
							<Flex className="thingPathDom-raw">{pathDom}</Flex>
							{editMode && (
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
							{pathDom && (
								<Flex className="thingPathDom" flexDirection="row" columnGap={1} marginTop={-1} paddingLeft={1}>
									<SettingsMenu
										setEditMode={setEditMode}
										transition="all 0.2s ease-in-out"
										opacity={showContextIcon ? 1 : 0}
										uuid={uuid}
										fullPath={fullPath}
										readonly={!editMode}
										onType={onChangeType}
										onDelete={deleteValue}
									></SettingsMenu>
								</Flex>
							)}
						</Flex>
					</Flex>
				)}
				{/* {showContextMenu && contextMenu} */}
				{/* this value will show in a few cases */}
				{/* Basic types like String, Number, etc.. non-object values */}
				{/* it will also show if the Thing has standard React children */}
				{/* overflowX auto (not scroll): scroll reserves a permanent
				scrollbar track that renders as a stray line under every value */}
				{!loading && !thingtimeChildren && atomicValue && (
					<Box className="atomicValue" width={'100%'} overflowX={'auto'}>
						{atomicValue}
					</Box>
				)}
				{/* render any normal React children as well */}
				{render && props?.children ? props.children : null}
				{/* render thingtime children */}
				{!loading && thingtimeChildren && !isCollapsed && (
					<Box className="thingtimeChildren" flexGrow={0} flexShrink={1} width={render ? '100%' : ''}>
						{thingtimeChildren}
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
									<SettingsMenu
										setEditMode={setEditMode}
										transition="all 0.2s ease-in-out"
										opacity={showNewContextIcon ? 1 : 0}
										uuid={uuid}
										iconSize={10}
										fullPath={fullPath}
										readonly={!editMode}
										onType={addNewChild}
									></SettingsMenu>
								</Flex>

								{/* <Icon size={7} name="plus"></Icon>
          <Icon size={7} name="plus"></Icon> */}
							</Flex>
						)}
					</Box>
				)}
				{!loading && thingtimeChildren && isCollapsed && (
					<Box className="thingtimeChildrenCollapsed" paddingLeft={multiplyPl(2)} paddingY={2} opacity={0.6}>
						<Flex color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="12px" userSelect="none">
							{thing instanceof Array ? `[…] ${thing.length}` : `{…} ${keys?.length || 0}`}
						</Flex>
					</Box>
				)}
			</Flex>
		</Safe>
	);
};;

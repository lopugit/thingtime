import React from 'react';
import { Box, Flex, Input, Spinner, Text, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';
import Fuse from 'fuse.js';

import { Thingtime } from '../Thingtime/Thingtime';
import { useThingtime } from '../Thingtime/useThingtime';
import { useLopu } from '../Lopu/useLopu';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { usePath } from '~/hooks/usePath';
import { useTtTheme } from '~/hooks/useTtTheme';
import { SECRET_WORDS, partyMode, rainbowFlash, pickSparkle } from '~/eggs/eggs';
import { commanderEnterSuggestionIndex, commanderSearchResults } from '../Search/commanderSearch';
import type { CommanderSearchResult } from '../Search/commanderSearch';
import type { SearchPerson, SearchResponse } from '../Search/searchTypes';
import { commanderCommandEnterIndex, matchCommanderCommands, runCommanderCommand } from './commanderCommands';
import type { CommanderCommandContext } from './commanderCommands';
import { parseCommanderLiteral } from './commanderLiteral';
import { shouldToggleCommanderFromKeydown } from './commanderShortcut';
import { QUICK_PAGES, pushQuickRecent, readQuickRecents } from '../QuickSwitcher/quickSwitcherCore';
import { QUICK_SWITCHER_TOGGLE_EVENT } from '../QuickSwitcher/QuickSwitcher';
import { DRAWER_MODAL_Z } from '../Nav/Drawer/useDrawer';
import { hasOpenOverlay } from '~/hooks/useFeedShortcuts';

export const CommanderV2 = (props) => {
	const { thingtime, setThingtime, getThingtime, thingtimeRef, paths } = useThingtime();

	const { changePath } = usePath();

	const navigate = useNavigate();
	const lopu = useLopu();
	const api = useApi();
	const user = useCurrentUser();
	const { setPreset: setThemePreset, builtinThemes } = useTtTheme();

	// ⌨️ `>` command registry (claude-todo/10). Side effects are injected so the
	// registry itself stays DOM-free and unit-testable.
	const commandContext = React.useMemo<CommanderCommandContext>(
		() => ({
			navigate: (to) => navigate(to),
			lopu,
			setThemePreset,
			builtinThemeNames: builtinThemes?.map((theme) => theme.name) || [],
			// >undo/>redo re-dispatch the chord the app-wide timeline listener
			// already handles (useThingtimeMachine) — no new provider API needed
			dispatchKeydown: (init) => window.dispatchEvent(new KeyboardEvent('keydown', init))
		}),
		[navigate, lopu, setThemePreset, builtinThemes]
	);

	const commanderId = React.useMemo(() => {
		return props?.id || 'global';
	}, [props?.id]);

	const inputRef = React.useRef<HTMLInputElement | null>(null);

	const global = props?.global;

	const commanderSettings = thingtime?.settings?.commander?.[commanderId] || {};

	const [inputValue, setInputValue] = React.useState('');
	const [virtualValue, setVirtualValue] = React.useState('');
	const [hoveredSuggestion, setHoveredSuggestion] = React.useState<number | null>(null);
	const [contextPath, setContextPath] = React.useState<string | undefined>();

	const [showContext, setShowContextState] = React.useState(false);

	const setShowContext = React.useCallback(
		(value, from?: string) => {
			setShowContextState(value);
		},
		[setShowContextState]
	);
	// const [suggestions, setSuggestions] = React.useState([])

	const contextValue = React.useMemo(() => {
		// TODO: Figure out why this is running on every click
		const ret = getThingtime(contextPath);
		return ret;
	}, [contextPath, getThingtime]);

	const commanderActive = React.useMemo(() => {
		return commanderSettings?.commanderActive;
	}, [commanderSettings?.commanderActive, commanderId]);

	// commanderActive useEffect
	React.useEffect(() => {
		if (commanderActive) {
			inputRef?.current?.focus?.();
		} else {
			// Closing Commander after an outside focus must not blur the input the
			// user just reached. Only release Commander's own input.
			if (document.activeElement === inputRef.current) inputRef.current?.blur?.();

			if (thingtimeRef?.current?.settings?.commander?.[commanderId]?.clearCommanderOnToggle) {
				setInputValue('');
				setHoveredSuggestion(null);
			}
			if (thingtimeRef?.current?.settings?.commander?.[commanderId]?.commander?.[commanderId]?.clearCommanderContextOnToggle) {
				setShowContext(false, 'commanderActive useEffect');
			}
			if (contextPath !== undefined && !inputValue) {
				setContextPath(undefined);
			}
			if (showContext !== false) {
				setShowContext(false);
			}
		}
	}, [commanderActive, thingtimeRef, setShowContext, commanderId, inputValue, contextPath, showContext]);

	const onInputChange = React.useCallback((e) => {
		setInputValue(e.target.value);
		setHoveredSuggestion(null);
	}, []);

	const validSetters = React.useMemo(() => {
		return ['=', ' is ', ' IS ', ' Is ', ' iS '];
	}, []);

	const command = React.useMemo(() => {
		// const sanitizedCommand = sanitise(value)
		// const sanitizedCommand = inputValue
		const sanitizedCommand = virtualValue;

		const validSetter = validSetters?.find((setter) => {
			if (sanitizedCommand?.includes(setter)) {
				return setter;
			}
			return false;
		});

		if (typeof validSetter === 'string') {
			const indexOfSplitter = sanitizedCommand?.indexOf(validSetter);
			const [pathRaw, valRaw] = [sanitizedCommand?.slice(0, indexOfSplitter), sanitizedCommand?.slice(indexOfSplitter + validSetter?.length)];

			return [pathRaw?.trim(), valRaw?.trim()];
		}
		return [sanitizedCommand];
	}, [
		// inputValue,
		virtualValue,
		validSetters
	]);

	const commandPath = React.useMemo(() => {
		return command?.[0];
		// return sanitise(command?.[0])
	}, [command]);

	const commandValue = React.useMemo(() => {
		return command?.[1];
	}, [command]);

	const commandIsAction = React.useMemo(() => {
		return commandPath && commandValue;
	}, [commandPath, commandValue]);

	const pathFuse = React.useMemo(() => new Fuse(paths || []), [paths]);
	const suggestions = React.useMemo(() => {
		try {
			const results = pathFuse.search(inputValue, { limit: 6 });

			const mappedResults = results?.map((result) => {
				return result?.item;
			});

			return mappedResults;
		} catch (err) {
			console.error('fuse error', err);
		}
	}, [inputValue, pathFuse]);

	// `>` prefix = command mode: the dropdown lists matching registry commands
	// instead of the search row + live/fuzzy results
	const commandMode = React.useMemo(() => {
		return (inputValue || '').trim().startsWith('>');
	}, [inputValue]);

	const commandMatches = React.useMemo(() => {
		return commandMode ? matchCommanderCommands(inputValue) : [];
	}, [commandMode, inputValue]);

	// A hovered row index only means anything against the row list that produced
	// it, and `>` mode swaps that list for a different one indexed from 0. Typing
	// `>` while row 2 was highlighted (arrowed or just moused over) would leave
	// row 2 pointing at `>undo`, so Enter silently undid the user's last change
	// instead of opening the palette. Drop the selection when the mode flips.
	React.useEffect(() => {
		setHoveredSuggestion(null);
	}, [commandMode]);

	// Commander is a live platform search, not just a fuzzy index over the
	// persisted local Thingtime tree. Debounce the same ACL-aware Things +
	// profile APIs used by /search, keep stale responses from repainting a newer
	// query, and leave local path commands available as a clearly separate tier.
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const remoteRequestRef = React.useRef(0);
	const [remoteSearch, setRemoteSearch] = React.useState<{ query: string; results: CommanderSearchResult[] }>({
		query: '',
		results: []
	});
	const [remoteLoadingQuery, setRemoteLoadingQuery] = React.useState('');
	const trimmedInput = inputValue.trim();

	React.useEffect(() => {
		const query = trimmedInput;
		// `>` command mode is a local registry lookup — never spend a search
		// request on it
		if (!commanderActive || commandMode || query.length < 2) {
			remoteRequestRef.current += 1;
			setRemoteLoadingQuery('');
			return;
		}

		const seq = ++remoteRequestRef.current;
		setRemoteLoadingQuery(query);
		const timer = window.setTimeout(async () => {
			try {
				const [thingsResponse, peopleResponse] = (await Promise.all([
					apiRef.current.v1.things.search({
						q: query,
						limit: 8,
						anon: user?.id ? undefined : 1
					}),
					apiRef.current.v1.profile.search({ q: query, limit: 4 }).catch(() => null)
				])) as [SearchResponse, { users?: SearchPerson[] } | null];
				if (seq !== remoteRequestRef.current) return;
				setRemoteSearch({
					query,
					results: commanderSearchResults({
						query,
						things: thingsResponse?.things,
						posts: thingsResponse?.posts,
						people: peopleResponse?.users
					})
				});
			} catch {
				// Typeahead search is progressive enhancement: keep local commands
				// and the full /search link usable when the network is unavailable.
				if (seq === remoteRequestRef.current) setRemoteSearch({ query, results: [] });
			} finally {
				if (seq === remoteRequestRef.current) setRemoteLoadingQuery('');
			}
		}, 250);

		return () => window.clearTimeout(timer);
	}, [commanderActive, commandMode, trimmedInput, user?.id]);

	const [recents, setRecents] = React.useState(() => readQuickRecents(user?.id));
	const pageFuse = React.useMemo(() => new Fuse(QUICK_PAGES, { keys: ['label', 'keywords'], threshold: 0.38, ignoreLocation: true }), []);
	React.useEffect(() => {
		setRecents(readQuickRecents(user?.id));
		setRemoteSearch({ query: '', results: [] });
		setInputValue('');
		setContextPath(undefined);
		setShowContext(false);
		remoteRequestRef.current += 1;
	}, [user?.id, setShowContext]);
	const quickRows = React.useMemo(
		() =>
			trimmedInput
				? pageFuse
						.search(trimmedInput)
						.slice(0, 5)
						.map((result) => result.item)
				: [...recents, ...QUICK_PAGES],
		[trimmedInput, pageFuse, recents]
	);
	const remoteResults: CommanderSearchResult[] = React.useMemo(() => {
		const seen = new Set<string>();
		return [
			...quickRows
				.filter((row) => row.href.startsWith('/') && !row.href.startsWith('//'))
				.map((row) => ({
					id: row.key,
					resultType: 'thing' as const,
					icon: row.glyph || '↗',
					avatarUrl: null,
					title: row.label,
					context: row.sublabel || (row.kind === 'page' ? 'Page' : 'Recent'),
					href: row.href
				})),
			...(remoteSearch.query === trimmedInput ? remoteSearch.results : [])
		].filter((row) => {
			if (seen.has(row.href)) return false;
			seen.add(row.href);
			return true;
		});
	}, [quickRows, remoteSearch, trimmedInput]);
	const remoteLoading = remoteLoadingQuery === trimmedInput;

	// dropdown rows: index 0 is the pinned full-search row; live platform
	// results follow; local fuzzy paths remain the final command tier. In `>`
	// command mode the rows are the matching commands instead, indexed from 0.
	const showSuggestions = commanderActive && (!commandMode || commandMatches.length > 0);

	const suggestionRowCount = React.useMemo(() => {
		if (commandMode) {
			return commandMatches.length;
		}
		return 1 + remoteResults.length + (suggestions?.length || 0);
	}, [commandMode, commandMatches, remoteResults.length, suggestions]);

	const closeCommander = React.useCallback(
		(e?: any) => {
			if (e?.defaultPrevented || !commanderActive) return;
			setThingtime(`settings.commander.${commanderId}.commanderActive`, false, { namespace: 'default', tabLocal: true });
		},
		[setThingtime, commanderId, commanderActive]
	);

	const selectSuggestion = React.useCallback(
		(suggestionIdx) => {
			if (commandMode) {
				const command = commandMatches?.[suggestionIdx];
				if (!command) return;
				const takesArgs = /[<[]/.test(command.usage);
				if (takesArgs) {
					// complete to ">name " and keep the palette open for the argument
					setInputValue(`>${command.name} `);
					setHoveredSuggestion(null);
					inputRef?.current?.focus?.();
					return;
				}
				runCommanderCommand(`>${command.name}`, commandContext);
				setInputValue('');
				setHoveredSuggestion(null);
				closeCommander();
				return;
			}
			if (suggestionIdx === 0) {
				const query = (inputValue || '').trim();
				console.log('Commander search row selected, navigating to /search', { query });
				navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
				setShowContext(false, 'Search things');
				setInputValue('');
				setHoveredSuggestion(null);
				setContextPath(undefined);
				closeCommander();
				return;
			}
			const remoteSuggestion = remoteResults[suggestionIdx - 1];
			if (remoteSuggestion) {
				setRecents(
					pushQuickRecent(user?.id, {
						key: remoteSuggestion.id,
						kind: remoteSuggestion.resultType === 'person' ? 'person' : 'thing',
						label: remoteSuggestion.title,
						href: remoteSuggestion.href,
						glyph: remoteSuggestion.icon,
						sublabel: remoteSuggestion.context
					})
				);
				navigate(remoteSuggestion.href);
				setShowContext(false, 'Platform search result');
				setInputValue('');
				setHoveredSuggestion(null);
				setContextPath(undefined);
				closeCommander();
				return;
			}

			const localSuggestionIndex = suggestionIdx - 1 - remoteResults.length;
			const suggestion = suggestions?.[localSuggestionIndex];
			if (!suggestion) return;

			const previewMode = false;

			if (previewMode) {
				setInputValue(suggestion);
				setHoveredSuggestion(null);
				setContextPath(suggestion);
				setShowContext(true, 'Select suggestion');
			} else {
				changePath({
					path: suggestion
				});

				setShowContext(false, 'Select suggestion');
				setInputValue('');
				setHoveredSuggestion(null);
				setContextPath(undefined);

				closeCommander();
			}
		},
		[
			setInputValue,
			setContextPath,
			setShowContext,
			suggestions,
			remoteResults,
			inputValue,
			navigate,
			changePath,
			commandMode,
			commandMatches,
			commandContext,
			closeCommander,
			user?.id
		]
	);

	const commandContainsPath = React.useMemo(() => {
		const commandIncludesSuggestion = suggestions?.find((suggestion) => {
			return commandPath?.includes(suggestion);
		});
		// return false
		return commandIncludesSuggestion;
	}, [commandPath, suggestions]);

	// Whether the palette is open is chrome for THIS viewport, not a shared
	// preference — `commanderId` is a literal ('nav'/'global'), identical in
	// every tab, so broadcasting it would toggle every other tab's palette and
	// move its focus. Closing is the damaging direction: the peer's toggle
	// effect below clears its input when `clearCommanderOnToggle` is set, which
	// would destroy a query someone is mid-way through typing there. Commander
	// *preferences* under the same key still sync normally.
	// Passing options replaces setThingtime's default object, so restate the
	// namespace these writes have always used rather than silently dropping it.
	const openCommander = React.useCallback(() => {
		setThingtime(`settings.commander.${commanderId}.commanderActive`, true, { namespace: 'default', tabLocal: true });
	}, [setThingtime, commanderId]);

	const toggleCommander = React.useCallback(() => {
		if (commanderSettings?.commanderActive) {
			closeCommander();
		} else {
			openCommander();
		}
	}, [thingtime?.settings?.commander, commanderSettings?.commanderActive, commanderId, closeCommander, openCommander]);

	const executeCommand = React.useCallback(() => {
		// ⌨️ `>` commands run through the registry and never fall through to the
		// path/setter machinery below. A hovered dropdown row wins over the raw
		// input (same rule as path suggestions).
		if (commanderActive && commandMode) {
			const rowIndex = commanderCommandEnterIndex({
				hoveredSuggestion,
				inputValue,
				matchCount: commandMatches?.length || 0
			});
			if (rowIndex !== null) {
				selectSuggestion(rowIndex);
				return;
			}
			runCommanderCommand(inputValue, commandContext);
			setInputValue('');
			setHoveredSuggestion(null);
			closeCommander();
			return;
		}

		// 🥚 Easter egg: secret words typed into the Commander and Entered.
		const secret = (inputValue || '').trim().toLowerCase();
		const secretWord = commanderActive ? SECRET_WORDS[secret] : undefined;
		if (secretWord) {
			setInputValue('');
			setHoveredSuggestion(null);
			closeCommander();
			if (secretWord === 'ode') {
				navigate('/ode');
			} else if (secretWord === 'rainbow') {
				rainbowFlash();
				lopu({ title: '🌈 Rainbow!', description: pickSparkle(), status: 'success' });
			} else {
				// unicorn / party / konami / lopu → the full celebration
				partyMode();
				lopu({
					title: secretWord === 'lopu' ? '🦄 Lopu says hi' : '🦄✨ You said the magic word',
					description: pickSparkle(),
					status: 'success'
				});
			}
			return;
		}

		// An explicit row wins. With no row selected, ordinary text defaults to
		// the pinned "Search things for…" row; setter commands still execute.
		const curSuggestionIdx = commanderEnterSuggestionIndex({
			hoveredSuggestion,
			showSuggestions: !!showSuggestions,
			commandIsAction: !!commandIsAction,
			inputValue
		});
		if (curSuggestionIdx !== null) {
			selectSuggestion(curSuggestionIdx);
			// Every suggestion owns its destination. Never also run the original
			// input through the local path/setter command path after selecting it.
			return;
		}
		if (commanderActive) {
			try {
				if (commandIsAction) {
					setThingtime(commandPath, parseCommanderLiteral(commandValue), {
						namespace: 'user'
					});
					// if (!prevVal) {
					setContextPath(commandPath);
					setShowContext(true, 'commandIsAction check');
					// }
				}
				// if (commandContainsPath)
				else {
					// const prevValue = getThingtime(commandPath)

					// const newValue = setThingtime(commandPath, prevValue)

					console.log('Setting context path', commandPath);
					// setContextPath(commandPath)

					changePath({
						path: commandPath
					});

					// setShowContext(true, "commandContainsPath check")

					// close commander after changing path
					closeCommander();
				}
			} catch (err) {
				console.error('Caught error on commander onEnter', err);
			}
		}
	}, [
		hoveredSuggestion,
		selectSuggestion,
		changePath,
		commanderActive,
		commandIsAction,
		commandPath,
		commandValue,
		showSuggestions,
		setThingtime,
		setContextPath,
		setShowContext,
		inputValue,
		closeCommander,
		navigate,
		lopu,
		commandMode,
		commandMatches,
		commandContext
	]);

	const allCommanderKeyListener = React.useCallback(
		(e: any) => {
			// don't do anything if commander is not focused
			const focused = document.activeElement === inputRef.current;
			if (!focused || e.isComposing || e.defaultPrevented) {
				return;
			}

			thingtimeRef.current = thingtime;
			if (e?.metaKey && e?.code === 'KeyP') {
				e.preventDefault();
				e.stopPropagation();
				toggleCommander();
			}
			// if key escape close all modals
			else if (e?.code === 'Escape') {
				console.log('Escape key pressed, closing commander if open');
				closeCommander();
			}

			// only run these if commander active

			if (commanderActive) {
				// arrow selection only means something while the dropdown is visible —
				// otherwise a stray ArrowDown would silently hover the (hidden) search
				// row and Enter would navigate away instead of running the command
				if (!showSuggestions && (e?.code === 'ArrowUp' || e?.code === 'ArrowDown')) {
					return;
				}
				// if arrow keys then move selection (row 0 = the pinned search row)
				if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e?.code)) e.preventDefault();
				if (e?.code === 'ArrowUp') {
					// move selection up
					const curSuggestionIdx = typeof hoveredSuggestion === 'number' ? hoveredSuggestion : suggestionRowCount;
					const newSuggestionIdx = curSuggestionIdx - 1;
					if (newSuggestionIdx >= 0) {
						setHoveredSuggestion(newSuggestionIdx);
					} else {
						setHoveredSuggestion(suggestionRowCount - 1);
					}
				} else if (e?.code === 'ArrowDown') {
					// move selection down
					const curSuggestionIdx = typeof hoveredSuggestion === 'number' ? hoveredSuggestion : -1;
					const newSuggestionIdx = curSuggestionIdx + 1;
					if (newSuggestionIdx < suggestionRowCount) {
						setHoveredSuggestion(newSuggestionIdx);
					} else {
						setHoveredSuggestion(0);
					}
				} else if (e?.code === 'Enter') {
					executeCommand();
				}
			}
		},
		[
			closeCommander,
			toggleCommander,
			hoveredSuggestion,
			suggestions,
			suggestionRowCount,
			showSuggestions,
			thingtime,
			thingtimeRef,
			commanderActive,
			executeCommand
		]
	);

	React.useEffect(() => {
		window.addEventListener('keydown', allCommanderKeyListener);

		return () => {
			window.removeEventListener('keydown', allCommanderKeyListener);
		};
	}, [allCommanderKeyListener]);

	// ⌨️ Cmd/Ctrl+K opens the Commander from anywhere (claude-todo/10). Only the
	// global (nav) instance listens so multiple mounted Commanders don't fight.
	// Unlike allCommanderKeyListener above, this must fire when the input is NOT
	// focused — that's the whole point.
	React.useEffect(() => {
		if (!global) {
			return;
		}
		const cmdKListener = (e: any) => {
			// commanderShortcut.ts owns the chord AND the one surface that outranks
			// it: Editor.js binds CMD+K to its link tool, so the palette yields
			// inside an editor block rather than opening on top of it.
			const mac = /Mac|iP(hone|ad|od)/i.test(navigator.platform || '');
			if (e.defaultPrevented || e.isComposing || (mac && e.ctrlKey) || (!commanderActive && hasOpenOverlay())) return;
			if (shouldToggleCommanderFromKeydown(e)) {
				e.preventDefault();
				toggleCommander();
			}
		};
		const onToggle = () => {
			if (commanderActive || !hasOpenOverlay()) toggleCommander();
		};
		window.addEventListener(QUICK_SWITCHER_TOGGLE_EVENT, onToggle);
		window.addEventListener('keydown', cmdKListener);

		return () => {
			window.removeEventListener(QUICK_SWITCHER_TOGGLE_EVENT, onToggle);
			window.removeEventListener('keydown', cmdKListener);
		};
	}, [global, toggleCommander, commanderActive]);

	React.useEffect(() => {
		// Only local path rows preview a virtual command value. The full-search
		// row and remote results preserve exactly what the user typed, and
		// command mode never previews a row into the input either.
		const localIndex = !commandMode && typeof hoveredSuggestion === 'number' ? hoveredSuggestion - 1 - remoteResults.length : -1;
		if (localIndex >= 0) {
			setVirtualValue(suggestions?.[localIndex]);
		} else {
			setVirtualValue(inputValue);
		}
	}, [commandMode, hoveredSuggestion, inputValue, remoteResults.length, suggestions]);

	React.useEffect(() => {
		setVirtualValue(inputValue);
	}, [inputValue]);

	React.useEffect(() => {
		if (hoveredSuggestion !== null) document.getElementById(`commander-option-${hoveredSuggestion}`)?.scrollIntoView({ block: 'nearest' });
	}, [hoveredSuggestion]);

	const rows = commandMode
		? commandMatches.map((entry) => ({ label: entry.usage, detail: entry.description, glyph: '›' }))
		: [
				{ label: trimmedInput ? `Search all Things for “${trimmedInput}”` : 'Search all Things', detail: 'Open full search', glyph: '🔍' },
				...remoteResults.map((row) => ({ label: row.title, detail: row.context, glyph: row.icon })),
				...(suggestions || []).map((path) => ({ label: path, detail: 'Local path', glyph: '💎' }))
		  ];
	return (
		<Modal isOpen={!!commanderActive} onClose={() => closeCommander()} initialFocusRef={inputRef} size="xl" scrollBehavior="inside">
			<ModalOverlay zIndex={DRAWER_MODAL_Z} />
			<ModalContent
				id="commander"
				className="commanderHost"
				data-commander-active="true"
				data-testid="commander-dialog"
				containerProps={{ zIndex: DRAWER_MODAL_Z }}
				maxWidth="min(620px, calc(100vw - 24px))"
				maxHeight="calc(100dvh - 100px)"
				marginTop="max(64px, calc(var(--thingtime-safe-area-top, 0px) + 56px))"
				marginBottom={3}
				background="var(--tt-card, white)"
				color="var(--tt-ink, #16161a)"
				borderRadius="16px"
			>
				<ModalHeader fontSize="sm" paddingBottom={2}>
					Commander search
				</ModalHeader>
				<ModalCloseButton aria-label="Close Commander search" />
				<ModalBody paddingTop={0} paddingBottom={4}>
					<Input
						ref={inputRef}
						value={inputValue}
						onChange={onInputChange}
						placeholder="Search Things, people, pages or >commands…"
						aria-label="Commander search"
						role="combobox"
						aria-expanded={!!showSuggestions}
						aria-controls="commander-suggestions"
						aria-autocomplete="list"
						aria-activedescendant={hoveredSuggestion === null ? undefined : `commander-option-${hoveredSuggestion}`}
						height="44px"
						background="var(--tt-surface-alt, #f5f5f7)"
					/>
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginY={2}>
						Search, jump to a page, or use &gt; for commands. ⌘K / Ctrl+K
					</Text>
					{!commandMode && remoteLoading && trimmedInput.length >= 2 ? (
						<Flex align="center" gap={2} fontSize="xs" role="status">
							<Spinner size="xs" />
							Searching…
						</Flex>
					) : null}
					<Box id="commander-suggestions" role="listbox" aria-label="Search results" maxHeight="min(52dvh, 420px)" overflowY="auto">
						{showSuggestions
							? rows.map((row, index) => (
									<Flex
										key={`${index}-${row.label}`}
										id={`commander-option-${index}`}
										role="option"
										aria-selected={hoveredSuggestion === index}
										align="center"
										gap={3}
										paddingX={3}
										paddingY={2}
										background={hoveredSuggestion === index ? 'var(--tt-surface-hover, #ececee)' : undefined}
										borderRadius="8px"
										cursor="pointer"
										onMouseDown={(event) => event.preventDefault()}
										onMouseEnter={() => setHoveredSuggestion(index)}
										onClick={() => selectSuggestion(index)}
									>
										<Text aria-hidden="true" flexShrink={0}>
											{row.glyph}
										</Text>
										<Box minWidth={0}>
											<Text fontSize="sm" fontWeight={600} noOfLines={1}>
												{row.label}
											</Text>
											<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={2}>
												{row.detail}
											</Text>
										</Box>
									</Flex>
							  ))
							: null}
					</Box>
					{showContext ? (
						<Box overflow="auto" maxHeight="35dvh">
							<Thingtime path={contextPath} thing={contextValue} />
						</Box>
					) : null}
				</ModalBody>
			</ModalContent>
		</Modal>
	);
};

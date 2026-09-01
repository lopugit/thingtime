import React from 'react';
import { Center, Flex, Input, Spinner, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';
import Fuse from 'fuse.js';

import { Rainbow } from '../Rainbow/Rainbow';
import { Thingtime } from '../Thingtime/Thingtime';
import { useThingtime } from '../Thingtime/useThingtime';
import { useLopu } from '../Lopu/useLopu';

import { sanitise } from '~/functions/sanitise';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { usePath } from '~/hooks/usePath';
import { SECRET_WORDS, partyMode, rainbowFlash, pickSparkle } from '~/eggs/eggs';
import { commanderEnterSuggestionIndex, commanderSearchResults } from '../Search/commanderSearch';
import type { CommanderSearchResult } from '../Search/commanderSearch';
import type { SearchPerson, SearchResponse } from '../Search/searchTypes';
import { CommanderClickAwayBoundary } from './commanderClickAway';
import { parseCommanderLiteral } from './commanderLiteral';

export const CommanderV2 = (props) => {
	const { thingtime, setThingtime, getThingtime, thingtimeRef, paths } = useThingtime();

	// log settings.commander.nav.commanderActive
	console.log('thingtime.settings.commander.nav.commanderActive', thingtime?.settings?.commander?.nav?.commanderActive);

	const { mode, changePath } = usePath();

	const navigate = useNavigate();
	const lopu = useLopu();
	const api = useApi();
	const user = useCurrentUser();

	const commanderId = React.useMemo(() => {
		return props?.id || 'global';
	}, [props?.id]);

	const inputRef = React.useRef<HTMLInputElement | null>(null);

	const global = props?.global;

	const commanderSettings = thingtime?.settings?.commander?.[commanderId] || {};

	const [inputValue, setInputValue] = React.useState('');
	const [virtualValue, setVirtualValue] = React.useState('');
	const [hoveredSuggestion, setHoveredSuggestion] = React.useState<number | null>(null);
	const [active, setActive] = React.useState(false);
	const [contextPath, setContextPath] = React.useState<string | undefined>();

	const commanderMode = React.useMemo(() => {
		return props?.mode || 'value';
	}, [props?.mode]);

	const [showContext, setShowContextState] = React.useState(false);

	// mobile chrome allowance: 52px for the fixed drawer trigger on the left
	// plus 148px reserved for the right-side nav icons (the notifications bell
	// joined the username + logo there — 108px started clipping under the pill)
	const mobileVW = React.useMemo(() => {
		return 'calc(100vw - 200px)';
	}, []);

	const rainbowRepeats = 2;

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
		if (!commanderActive || query.length < 2) {
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
	}, [commanderActive, trimmedInput, user?.id]);

	const remoteResults = remoteSearch.query === trimmedInput ? remoteSearch.results : [];
	const remoteLoading = remoteLoadingQuery === trimmedInput;

	// dropdown rows: index 0 is the pinned full-search row; live platform
	// results follow; local fuzzy paths remain the final command tier.
	const showSuggestions = React.useMemo(() => {
		return inputValue?.length && commanderActive && !commanderSettings?.commanderActive?.hideSuggestionsOnToggle;
	}, [
		inputValue,
		suggestions,
		commanderActive,
		commanderId,
		thingtime?.settings?.commander,
		commanderSettings?.commanderActive?.hideSuggestionsOnToggle
	]);

	const suggestionRowCount = React.useMemo(() => 1 + remoteResults.length + (suggestions?.length || 0), [remoteResults.length, suggestions]);

	const selectSuggestion = React.useCallback(
		(suggestionIdx) => {
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
		// closeCommander is declared below — referenced in the closure body only
		// (calling it at select time is fine; naming it in deps would hit the TDZ)
		[setInputValue, setContextPath, setShowContext, suggestions, remoteResults, inputValue, navigate, changePath]
	);

	const commandContainsPath = React.useMemo(() => {
		const commandIncludesSuggestion = suggestions?.find((suggestion) => {
			return commandPath?.includes(suggestion);
		});
		// return false
		return commandIncludesSuggestion;
	}, [commandPath, suggestions]);

	const openCommander = React.useCallback(() => {
		setThingtime(`settings.commander.${commanderId}.commanderActive`, true);
	}, [setThingtime, commanderId]);

	const closeCommander = React.useCallback(
		(e?: any) => {
			if (e?.defaultPrevented || !commanderActive) return;
			setThingtime(`settings.commander.${commanderId}.commanderActive`, false);
		},
		[setThingtime, commanderId, commanderActive]
	);

	const toggleCommander = React.useCallback(() => {
		if (commanderSettings?.commanderActive) {
			closeCommander();
		} else {
			openCommander();
		}
	}, [thingtime?.settings?.commander, commanderSettings?.commanderActive, commanderId, closeCommander, openCommander]);

	const executeCommand = React.useCallback(() => {
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
		lopu
	]);

	const allCommanderKeyListener = React.useCallback(
		(e: any) => {
			// don't do anything if commander is not focused
			const focused = document.activeElement === inputRef.current;
			if (!focused) {
				return;
			}

			console.log('commander key listener e?.code', e?.code);
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

	React.useEffect(() => {
		// Only local path rows preview a virtual command value. The full-search
		// row and remote results preserve exactly what the user typed.
		const localIndex = typeof hoveredSuggestion === 'number' ? hoveredSuggestion - 1 - remoteResults.length : -1;
		if (localIndex >= 0) {
			setVirtualValue(suggestions?.[localIndex]);
		} else {
			setVirtualValue(inputValue);
		}
	}, [hoveredSuggestion, inputValue, remoteResults.length, suggestions]);

	React.useEffect(() => {
		setVirtualValue(inputValue);
	}, [inputValue]);

	const electronCommanderInputSx = React.useMemo(
		() => ({
			transition: 'opacity 0.14s ease-out, transform 0.14s ease-out, box-shadow 0.14s ease-out',
			'html.thingtime-electron-desktop #commander[data-commander-active="false"] &': {
				display: 'none',
				opacity: 0,
				pointerEvents: 'none',
				transform: 'translateY(-6px) scale(0.98)'
			},
			'html.thingtime-electron-desktop #commander[data-commander-active="true"] &': {
				display: 'flex',
				opacity: 1,
				transform: 'translateY(0) scale(1)',
				boxShadow: 'var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))'
			}
		}),
		[]
	);

	return (
		<CommanderClickAwayBoundary onClickAway={closeCommander}>
			<Flex
				className="commanderHost"
				data-commander-active={commanderActive ? 'true' : 'false'}
				position="absolute"
				zIndex={9999}
				top={0}
				right={0}
				// position='fixed'
				// top='100px'
				left={0}
				justifyContent={['flex-start', 'center']}
				// display={["flex", commanderActive ? "flex" : "none"]}
				maxWidth="100%"
				height={12}
				// height="100%"
				pointerEvents="none"
				id="commander"
				paddingLeft={['52px', 1]}
				paddingRight={1}
				sx={{
					'html.thingtime-electron-desktop &': {
						top: 'calc(var(--thingtime-electron-titlebar-height, 52px) + 8px)',
						right: 'auto',
						left: '50%',
						width: 'min(420px, calc(100vw - 32px))',
						height: '48px',
						paddingLeft: 0,
						paddingRight: 0,
						transform: 'translateX(-50%)',
						zIndex: 10050
					}
				}}
			>
				<Flex
					position="absolute"
					zIndex={9999}
					top="100%"
					right={0}
					left={0}
					alignItems={['flex-start', 'center']}
					flexDirection="column"
					maxWidth="100%"
					height="auto"
					marginTop={2}
					borderRadius="12px"
					marginX={1}
				>
					<Flex
						alignItems={['flex-start', 'center']}
						flexDirection="column"
						overflowY="scroll"
						width="auto"
						maxWidth="100%"
						maxHeight="90vh"
						borderRadius="12px"
					>
						<Flex
							flexDirection="column"
							flexShrink={0}
							display={showSuggestions ? 'flex' : 'none'}
							overflowY="scroll"
							width={['100%', '400px']}
							maxWidth="100%"
							maxHeight="300px"
							marginBottom={3}
							background="var(--tt-surface-alt, #f5f5f7)"
							borderRadius="var(--tt-radius-md, 12px)"
							boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
							pointerEvents="all"
							id="commander-suggestions"
							onMouseLeave={() => setHoveredSuggestion(null)}
							paddingY={3}
						>
							<Flex
								background={hoveredSuggestion === 0 ? 'var(--tt-surface-hover, #ececee)' : null}
								_hover={{
									background: 'var(--tt-surface-hover, #ececee)'
								}}
								cursor="pointer"
								fontFamily="mono"
								fontSize="13px"
								color="var(--tt-text, #5a5a66)"
								onClick={() => selectSuggestion(0)}
								onMouseEnter={() => setHoveredSuggestion(0)}
								paddingX={4}
								paddingY={1}
							>
								🔍 Search things for “{inputValue}”
							</Flex>
							{remoteLoading ? (
								<Flex align="center" color="var(--tt-muted, #9a9aa6)" fontSize="11px" gap={2} px={4} py={2}>
									<Spinner size="xs" />
									Searching across Thingtime…
								</Flex>
							) : null}
							{remoteResults.length ? (
								<Text
									color="var(--tt-muted, #9a9aa6)"
									fontFamily="mono"
									fontSize="10px"
									fontWeight="700"
									px={4}
									pb={1}
									pt={2}
									textTransform="uppercase"
								>
									Across Thingtime
								</Text>
							) : null}
							{remoteResults.map((result, i) => {
								const suggestionIndex = i + 1;
								return (
									<Flex
										key={`${result.resultType}-${result.id}`}
										background={hoveredSuggestion === suggestionIndex ? 'var(--tt-surface-hover, #ececee)' : null}
										_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
										cursor="pointer"
										align="center"
										onClick={() => selectSuggestion(suggestionIndex)}
										onMouseEnter={() => setHoveredSuggestion(suggestionIndex)}
										gap={2.5}
										paddingX={4}
										paddingY={1.5}
									>
										<Center
											background="var(--tt-card, #ffffff)"
											border="1px solid var(--tt-border, #ececef)"
											borderRadius="full"
											flexShrink={0}
											height="32px"
											overflow="visible"
											position="relative"
											width="32px"
										>
											{result.resultType === 'person' && result.avatarUrl ? (
												<img
													alt=""
													src={result.avatarUrl}
													style={{ borderRadius: '999px', height: '100%', objectFit: 'cover', width: '100%' }}
												/>
											) : (
												<Text aria-hidden="true" fontSize="16px">
													{result.resultType === 'person' ? result.title.slice(0, 1).toUpperCase() : result.icon}
												</Text>
											)}
											{result.resultType === 'person' ? (
												<Center
													aria-label="User result"
													background="var(--tt-card, #ffffff)"
													border="1px solid var(--tt-border, #ececef)"
													borderRadius="full"
													bottom="-3px"
													fontSize="10px"
													height="16px"
													position="absolute"
													right="-4px"
													width="16px"
												>
													{result.icon}
												</Center>
											) : null}
										</Center>
										<Flex direction="column" minWidth={0} flex="1">
											<Text color="var(--tt-text, #5a5a66)" fontSize="13px" fontWeight="600" noOfLines={1}>
												{result.title}
											</Text>
											<Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="10px" noOfLines={1}>
												{result.context}
											</Text>
										</Flex>
									</Flex>
								);
							})}
							{suggestions?.length ? (
								<Text
									color="var(--tt-muted, #9a9aa6)"
									fontFamily="mono"
									fontSize="10px"
									fontWeight="700"
									px={4}
									pb={1}
									pt={2}
									textTransform="uppercase"
								>
									Local paths
								</Text>
							) : null}
							{suggestions?.map((suggestion, i) => {
								const suggestionIndex = i + 1 + remoteResults.length;
								return (
									<Flex
										key={i}
										background={hoveredSuggestion === suggestionIndex ? 'var(--tt-surface-hover, #ececee)' : null}
										_hover={{
											background: 'var(--tt-surface-hover, #ececee)'
										}}
										cursor="pointer"
										fontFamily="mono"
										fontSize="13px"
										color="var(--tt-text, #5a5a66)"
										onClick={() => selectSuggestion(suggestionIndex)}
										onMouseEnter={() => setHoveredSuggestion(suggestionIndex)}
										paddingX={4}
										paddingY={1}
									>
										{suggestion}
									</Flex>
								);
							})}
						</Flex>
						{showContext && (
							<Flex
								display={showContext ? 'flex' : 'none'}
								maxWidth="100%"
								background="var(--tt-surface-alt, #f5f5f7)"
								borderRadius="var(--tt-radius-md, 12px)"
								boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
								pointerEvents="all"
								paddingY={3}
							>
								<Thingtime width="600px" path={contextPath} thing={contextValue}></Thingtime>
							</Flex>
						)}
					</Flex>
				</Flex>
				<Center position="relative" width={['100%', '400px']} maxWidth={[mobileVW, '100%']} height="100%">
					{/* TODO: Fix duplicate code because of rainbow mode disabling hack */}
					{props?.rainbow && (
						<Rainbow
							filter="blur(15px)"
							opacity={commanderActive ? 0.25 : 0}
							repeats={rainbowRepeats}
							thickness={8}
							opacityTransition="all 1000ms ease-out"
							overflow="visible"
						>
							<Center
								className="commanderInputShell"
								position="relative"
								zIndex={9999}
								overflow="hidden"
								width={['100%', '400px']}
								maxWidth={[mobileVW, '100%']}
								height="100%"
								padding="1px"
								borderRadius="var(--tt-radius-sm, 9px)"
								pointerEvents="all"
								outline="none"
								sx={electronCommanderInputSx}
							>
								<Rainbow
									opacity={commanderActive ? 0.6 : 0}
									position="absolute"
									repeats={rainbowRepeats}
									opacityTransition="all 2500ms ease-out"
									thickness={10}
								></Rainbow>
								<Input
									// display='none'
									// opacity={0}
									ref={inputRef}
									sx={{
										'&::placeholder': {
											color: 'var(--tt-muted, #9a9aa6)'
											// color: "white",
										}
									}}
									zIndex={9999}
									width="100%"
									height="100%"
									background="var(--tt-surface-alt, #f5f5f7)"
									border="none"
									borderRadius="var(--tt-radius-xs, 7px)"
									outline="none"
									onChange={onInputChange}
									onFocus={openCommander}
									placeholder="Imagine.."
									value={inputValue}
								></Input>
							</Center>
						</Rainbow>
					)}
					{!props?.rainbow && (
						<Center
							className="commanderInputShell"
							position="relative"
							zIndex={9999}
							overflow="hidden"
							width={['100%', '400px']}
							maxWidth={[mobileVW, '100%']}
							height="100%"
							padding="1px"
							borderRadius="var(--tt-radius-sm, 9px)"
							pointerEvents="all"
							outline="none"
							sx={electronCommanderInputSx}
						>
							<Input
								// display='none'
								// opacity={0}
								ref={inputRef}
								sx={{
									'&::placeholder': {
										color: 'var(--tt-muted, #9a9aa6)'
										// color: "white",
										// textShadow: "0 0 5px black",
									}
								}}
								zIndex={9999}
								width="100%"
								height="100%"
								background="var(--tt-surface-alt, #f5f5f7)"
								border="none"
								borderRadius="var(--tt-radius-xs, 7px)"
								outline="none"
								onChange={onInputChange}
								onFocus={openCommander}
								placeholder="Imagine.."
								value={inputValue}
							></Input>
						</Center>
					)}
				</Center>
			</Flex>
		</CommanderClickAwayBoundary>
	);
};

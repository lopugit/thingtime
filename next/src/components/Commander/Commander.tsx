import React from 'react';
import ClickAwayListener from 'react-click-away-listener';
import { Box, Center, Flex, Input } from '@chakra-ui/react';
import Fuse from 'fuse.js';

import { MagicInput } from '../MagicInput/MagicInput';
import { Rainbow } from '../Rainbow/Rainbow';
import { Thingtime } from '../Thingtime/Thingtime';
import { useThingtime } from '../Thingtime/useThingtime';

import { sanitise } from '@/functions/sanitise';
import { getParentPath } from '@/smarts';

export const Commander = (props: any) => {
  const { thingtime, setThingtime, getThingtime, thingtimeRef, paths } = useThingtime();

  const commanderId = React.useMemo(() => {
    return props?.id || 'global';
  }, [props?.id]);

  const inputRef = React.useRef();

  const global = props?.global;

  const commanderSettings = React.useMemo(() => {
    return thingtime?.settings?.commander?.[commanderId] || {};
  }, [thingtime?.settings?.commander, thingtime?.settings?.commander?.[commanderId], commanderId]);

  const [inputValue, setInputValue] = React.useState('');
  const [virtualValue, setVirtualValue] = React.useState('');
  const [hoveredSuggestion, setHoveredSuggestion] = React.useState();
  const [active, setActive] = React.useState(false);
  const [contextPath, setContextPath] = React.useState();

  const mode = React.useMemo(() => {
    return props?.mode || 'value';
  }, [props?.mode]);

  const [showContext, setShowContextState] = React.useState(false);

  const mobileVW = React.useMemo(() => {
    return 'calc(100vw - 55px)';
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
    return thingtime?.settings?.commander?.[commanderId]?.commanderActive;
  }, [commanderSettings, commanderId]);

  // commanderActive useEffect
  React.useEffect(() => {
    if (commanderActive) {
      if (props?.global) {
        inputRef?.current?.focus?.();
      }
    } else {
      if (props?.global) {
        document.activeElement.blur();
      }

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
  }, [commanderActive, thingtimeRef, setShowContext, props?.global, commanderId, inputValue, contextPath, showContext]);

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
    const sanitizedInput = virtualValue;

    const validSetter = validSetters?.find((setter) => {
      if (sanitizedInput?.includes(setter)) {
        return setter;
      }
      return false;
    });

    if (typeof validSetter === 'string') {
      const indexOfSplitter = sanitizedInput?.indexOf(validSetter);
      const [pathRaw, valRaw] = [sanitizedInput?.slice(0, indexOfSplitter), sanitizedInput?.slice(indexOfSplitter + validSetter?.length)];

      const pathTrimmed = pathRaw?.trim();

      let path = pathTrimmed;

      if (pathTrimmed && props?.pathPrefix) {
        path = props?.pathPrefix + '.' + pathTrimmed;
      } else if (props?.pathPrefix) {
        path = props?.pathPrefix;
      }

      return [path, valRaw?.trim()];
    }

    if (props?.pathPrefix) {
      return [props?.pathPrefix, sanitizedInput];
    }

    return [sanitizedInput];
  }, [
    // inputValue,
    props?.pathPrefix,
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

  const validQuotations = React.useMemo(() => {
    return ['"', "'"];
  }, []);

  const escapedCommandValue = React.useMemo(() => {
    // replace quotations with escaped quoations except for first and last quotation
    const startingQuotation = commandValue?.[0];
    const endingQuotation = commandValue?.[commandValue?.length - 1];
    const isQuoted = validQuotations?.includes(startingQuotation) && validQuotations?.includes(endingQuotation);
    const restOfCommandValue = isQuoted ? commandValue?.slice(1, commandValue?.length - 1) : commandValue;
    const escaped = restOfCommandValue?.replace(/"/g, '\\"')?.replace(/'/g, "\\'")?.replace(/`/g, '\\`');

    const ret = `\`${escaped}\``;
    return ret;
  }, [commandValue, validQuotations]);

  const commandIsAction = React.useMemo(() => {
    return commandPath && commandValue;
  }, [commandPath, commandValue]);

  const suggestions = React.useMemo(() => {
    try {
      const fuse = new Fuse(paths);

      const results = fuse.search(inputValue);

      const mappedResults = results?.map((result) => {
        return result?.item;
      });

      return mappedResults;
    } catch (err) {
      console.error('fuse error', err);
    }
  }, [inputValue, paths]);

  const showSuggestions = React.useMemo(() => {
    return inputValue?.length && suggestions?.length && commanderActive && thingtime?.settings?.commander?.[commanderId]?.hideSuggestionsOnToggle;
  }, [inputValue, suggestions, commanderActive, commanderId, thingtime?.settings?.commander, commanderSettings]);

  const selectSuggestion = React.useCallback(
    (suggestionIdx) => {
      const suggestion = suggestions?.[suggestionIdx];

      setInputValue(suggestion);
      setHoveredSuggestion(null);
      setContextPath(suggestion);
      setShowContext(true, 'Select suggestion');
    },
    [setInputValue, setContextPath, setShowContext, suggestions]
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
      if (!e?.defaultPrevented) {
        if (thingtime?.settings?.commander?.[commanderId]?.commanderActive) {
          setThingtime(`settings.commander.${commanderId}.commanderActive`, false);
        }
      }
    },
    [setThingtime, commanderId, commanderSettings, thingtime?.settings?.commander]
  );

  const toggleCommander = React.useCallback(() => {
    if (thingtime?.settings?.commander?.[commanderId]?.commanderActive) {
      closeCommander();
    } else {
      openCommander();
    }
  }, [thingtime?.settings?.commander, commanderSettings, commanderId, closeCommander, openCommander]);

  const executeCommand = React.useCallback(() => {
    // if selection is active then select it
    const curSuggestionIdx = hoveredSuggestion;
    if (curSuggestionIdx !== null) {
      selectSuggestion(curSuggestionIdx);
    }
    if (commanderActive) {
      try {
        if (commandIsAction) {
          // nothing
          const prevVal = getThingtime(commandPath);
          const parentPath = getParentPath(commandPath) || 'thingtime';
          try {
            // first try to execute literal javscript
            const fn = `() => { return ${commandValue} }`;
            const tt = thingtime;
            const evalFn = eval(fn);
            const realVal = evalFn();
            setThingtime(commandPath, realVal);
          } catch (err) {
            console.log('Caught error after trying to execute literal javascript', err);

            // likely literaly javascript wasn't valid
            try {
              const fn = `() => { return ${escapedCommandValue} }`;
              const tt = thingtime;
              const evalFn = eval(fn);
              const realVal = evalFn();
              const prevVal = getThingtime(commandPath);
              const parentPath = getParentPath(commandPath);
              setThingtime(commandPath, realVal);
            } catch {
              // something very bad went wrong
              console.log('Caught error after trying to execute escaped literal javascript', err);
            }
          }
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
          setContextPath(commandPath);
          setShowContext(true, 'commandContainsPath check');
        }
      } catch (err) {
        console.error('Caught error on commander onEnter', err);
      }
    }
  }, [
    hoveredSuggestion,
    selectSuggestion,
    commanderActive,
    commandIsAction,
    commandPath,
    thingtime,
    commandValue,
    escapedCommandValue,
    getThingtime,
    setThingtime,
    setContextPath,
    setShowContext
  ]);

  const allCommanderKeyListener = React.useCallback(
    (e: any) => {
      console.log('commander key listener e?.code', e?.code);
      thingtimeRef.current = thingtime;
      if (e?.metaKey && e?.code === 'KeyP') {
        e.preventDefault();
        e.stopPropagation();
        toggleCommander();
      }
      // if key escape close all modals
      else if (e?.code === 'Escape') {
        closeCommander();
      }

      // only run these if commander active

      if (commanderActive) {
        // if arrow keys then move selection
        if (e?.code === 'ArrowUp') {
          // move selection up
          const curSuggestionIdx = typeof hoveredSuggestion === 'number' ? hoveredSuggestion : suggestions?.length;
          const newSuggestionIdx = curSuggestionIdx - 1;
          if (newSuggestionIdx >= 0) {
            setHoveredSuggestion(newSuggestionIdx);
          } else {
            setHoveredSuggestion(suggestions?.length - 1);
          }
        } else if (e?.code === 'ArrowDown') {
          // move selection down
          const curSuggestionIdx = typeof hoveredSuggestion === 'number' ? hoveredSuggestion : -1;
          const newSuggestionIdx = curSuggestionIdx + 1;
          if (newSuggestionIdx < suggestions?.length) {
            setHoveredSuggestion(newSuggestionIdx);
          } else {
            setHoveredSuggestion(0);
          }
        } else if (e?.code === 'Enter') {
          // if not shift enter then execute command
          if (!e?.shiftKey) {
            executeCommand();
          }
        }
      }
    },
    [closeCommander, toggleCommander, hoveredSuggestion, suggestions, thingtime, thingtimeRef, commanderActive, executeCommand]
  );

  React.useEffect(() => {
    window.addEventListener('keydown', allCommanderKeyListener);

    return () => {
      window.removeEventListener('keydown', allCommanderKeyListener);
    };
  }, [allCommanderKeyListener]);

  React.useEffect(() => {
    if (typeof hoveredSuggestion === 'number') {
      setVirtualValue(suggestions?.[hoveredSuggestion]);
    } else {
      setVirtualValue(inputValue);
    }
  }, [hoveredSuggestion, inputValue, suggestions]);

  React.useEffect(() => {
    setVirtualValue(inputValue);
  }, [inputValue]);

  const onMagicInput = React.useCallback((args) => {
    // props?.onValueChange?.(args)

    setInputValue(args?.value);
    setHoveredSuggestion(null);
  }, []);

  const InputPartWrapper = React.useCallback(
    (props: any) => {
      return <Box paddingX={commanderActive ? 1 : 0}>{props?.children}</Box>;
    },
    [commanderActive]
  );

  const InputPart = React.useMemo(() => {
    if (props?.simple) {
      return (
        <Input
          // display='none'
          // opacity={0}
          ref={inputRef}
          sx={{
            '&::placeholder': {
              color: 'greys.dark'
              // color: "white",
            }
          }}
          width="100%"
          height="100%"
          background="grey"
          border="none"
          borderRadius="5px"
          outline="none"
          onChange={onInputChange}
          onFocus={openCommander}
          placeholder="Imagine.."
          value={inputValue}
        ></Input>
      );
    }

    return (
      <MagicInput
        placeholder={props?.placeholder || 'Imagine..'}
        onValueChange={onMagicInput}
        onFocus={openCommander}
        chakras={{
          marginX: commanderActive && props?.rainbow ? 4 : 0
        }}
        transition="all 0.5s ease-in-out"
      ></MagicInput>
    );
  }, [inputRef, onInputChange, commanderActive, props?.rainbow, props?.placeholder, openCommander, onMagicInput, props?.simple, inputValue]);

  return (
    <ClickAwayListener onClickAway={closeCommander}>
      <Flex
        // position="absolute"
        // top={0}
        // right={0}
        // left={0}
        // zIndex={99999}
        // position='fixed'
        // top='100px'
        className={'commander-uuid-' + commanderId}
        // display={["flex", commanderActive ? "flex" : "none"]}
        justifyContent="flex-start"
        width="100%"
        maxWidth="100%"
        // height="100%"
        // paddingX={1}
      >
        <Center position="relative" flexDirection="column" width={['100%', '400px']} maxWidth={[mobileVW, '100%']} height="100%">
          {props?.rainbow && (
            <Rainbow
              filter="blur(15px)"
              opacity={commanderActive ? 0.25 : 0}
              repeats={rainbowRepeats}
              thickness={10}
              opacityTransition="all 1000ms ease-out"
              overflow="visible"
            >
              <Center
                position="relative"
                overflow="hidden"
                width={['100%', '400px']}
                maxWidth={[mobileVW, '100%']}
                height="100%"
                padding="1px"
                borderRadius="6px"
                pointerEvents="all"
                outline="none"
              >
                <Rainbow
                  opacity={commanderActive ? 0.6 : 0}
                  position="absolute"
                  repeats={rainbowRepeats}
                  opacityTransition="all 2500ms ease-out"
                  thickness={1}
                >
                  {/* <InputPartWrapper>{InputPart}</InputPartWrapper> */}
                  {InputPart}
                </Rainbow>
              </Center>
            </Rainbow>
          )}
          {!props?.rainbow && InputPart}
        </Center>
        <Flex
          // position="absolute"
          // top="100%"
          // right={0}
          // left={0}
          alignItems="flex-start"
          flexDirection="column"
          maxWidth="100%"
          height="auto"
          // marginTop={2}
          borderRadius="12px"
          // marginX={1}
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
              background="grey"
              borderRadius="12px"
              pointerEvents="all"
              id="commander-suggestions"
              onMouseLeave={() => setHoveredSuggestion(null)}
              paddingY={3}
            >
              {suggestions?.map((suggestion, i) => {
                return (
                  <Flex
                    key={i}
                    background={hoveredSuggestion === i ? 'greys.lightt' : null}
                    _hover={{
                      background: 'greys.lightt'
                    }}
                    cursor="pointer"
                    onClick={() => selectSuggestion(i)}
                    onMouseEnter={() => setHoveredSuggestion(i)}
                    paddingX={4}
                  >
                    {suggestion}
                  </Flex>
                );
              })}
            </Flex>
            {showContext && props?.context && (
              <Flex display={showContext ? 'flex' : 'none'} maxWidth="100%" background="grey" borderRadius="12px" pointerEvents="all" paddingY={3}>
                <Thingtime width="600px" path={contextPath} thing={contextValue}></Thingtime>
              </Flex>
            )}
          </Flex>
        </Flex>
      </Flex>
    </ClickAwayListener>
  );
};

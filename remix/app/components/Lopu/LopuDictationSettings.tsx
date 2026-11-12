import React from 'react';
import { Flex, Input, Switch, Text } from '@chakra-ui/react';
import { normalizeDictationSilenceSeconds } from './dictationSilence';
import { useLopuSettings } from './useLopuSettings';

export const LopuDictationSettings = ({ renderRow }: {
	renderRow: (label: string, control: React.ReactNode, hint?: string) => React.ReactNode;
}) => {
	const { settings, setDictationSilenceSeconds, setHearMeOut } = useLopuSettings();
	const [delay, setDelay] = React.useState(String(settings.dictationSilenceSeconds));
	React.useEffect(() => setDelay(String(settings.dictationSilenceSeconds)), [settings.dictationSilenceSeconds]);
	const commit = () => {
		const value = delay.trim() ? Number(delay) : settings.dictationSilenceSeconds;
		const seconds = normalizeDictationSilenceSeconds(value);
		setDelay(String(seconds));
		setDictationSilenceSeconds(seconds);
	};
	return <>
		{renderRow('Silence before sending', <Flex gap={2} align="center">
			<Input type="number" inputMode="decimal" size="sm" width="80px" min={1} max={120} step={0.1}
				aria-label="Silence before sending in seconds" value={delay}
				onChange={event => setDelay(event.target.value)} onBlur={commit}
				onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
			<Text fontSize="sm">seconds</Text>
		</Flex>, 'Mac and browser dictation sends the message and stops listening after this pause. Default 5 seconds; choose 1–120.')}
		{renderRow('Hear me out', <Switch isChecked={settings.hearMeOut} onChange={event => setHearMeOut(event.target.checked)} aria-label="Hear me out" />,
			'Keep dictating until you choose Send. Every 10 seconds of silence, ask “Send now?” instead. Applies across chats and uses device dictation.')}
	</>;
};

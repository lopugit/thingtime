import React from 'react';
import { Box, Center } from '@chakra-ui/react';
import { useLocation } from 'react-router';

import { LopuActivityBadge, LopuRingAvatar } from './LopuActivityBadge';
import { LOPU_UI } from './lopuTheme';
import { isLopuHostHiddenOnPath, useLopuSettings } from './useLopuSettings';

// 🦄 The navbar opener: the same 28px 🦄-on-a-rainbow-ring as the floating
// launcher (so the two read as one object), mounted in Nav's right section
// just before the ⌘K quick switcher on desktop and mobile. A click toggles
// the floating chat window — even when the launcher bubble itself is turned
// off in settings — and the shared streaming badge pulses in its corner
// while one of Lopu's turns is still streaming. On /lopu* the page IS the
// chat, so the button renders nothing there.

export const LOPU_NAV_BUTTON_LABEL = 'Talk to Lopu';

export const LopuNavButton = () => {
	const { pathname } = useLocation();
	const { open, toggleOpen } = useLopuSettings();

	const onClick = React.useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			toggleOpen();
		},
		[toggleOpen]
	);

	if (isLopuHostHiddenOnPath(pathname)) {
		return null;
	}

	return (
		<Center
			className="nav-lopu-button"
			as="button"
			type="button"
			aria-label={open ? 'Hide Lopu' : LOPU_NAV_BUTTON_LABEL}
			aria-pressed={open}
			title={`${LOPU_NAV_BUTTON_LABEL} 🦄`}
			position="relative"
			// a full-height hit area on touch, the ring itself stays 28px
			width={['40px', '36px']}
			height={['40px', '36px']}
			borderRadius="999px"
			cursor="pointer"
			transition={`transform ${LOPU_UI.transitionFast}, box-shadow ${LOPU_UI.transitionFast}`}
			_hover={{ transform: 'translateY(-1px)' }}
			_active={{ transform: 'translateY(0)' }}
			_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '2px' }}
			sx={{
				WebkitTapHighlightColor: 'transparent',
				touchAction: 'manipulation',
				'@media (prefers-reduced-motion: reduce)': { transition: 'none' }
			}}
			onClick={onClick}
		>
			<Box as="span" position="relative" display="inline-flex" lineHeight={0}>
				<LopuRingAvatar size={28} />
				<LopuActivityBadge placement="corner" size={9} />
			</Box>
		</Center>
	);
};

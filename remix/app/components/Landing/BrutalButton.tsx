import { Box } from '@chakra-ui/react';
import React from 'react';

type BrutalVariant = 'primary' | 'secondary' | 'ink';

/**
 * Neo-brutalist CTA from the v2-fable landing: chunky ink border, hard offset
 * shadow, hover lift. Renders as <button> or (with href) <a>.
 */
export const BrutalButton = ({
	variant = 'primary',
	href,
	target,
	rel,
	onClick,
	children,
	shadow = true,
	chakras = {},
	...props
}: any) => {
	const variants: Record<BrutalVariant, any> = {
		primary: {
			background: 'var(--tt-accent, hotpink)',
			color: 'var(--tt-accent-contrast, #fff)'
		},
		secondary: {
			background: 'var(--tt-card, #fff)',
			color: 'var(--tt-ink, #1a1a1a)',
			_hover: { background: 'var(--tt-accent-tint, #fff5fa)' }
		},
		ink: {
			background: 'var(--tt-ink, #1a1a1a)',
			color: 'var(--tt-card, #fff)'
		}
	};

	const variantStyle = variants[variant as BrutalVariant] || variants.primary;
	const hoverLift = {
		...(variantStyle._hover || {}),
		...(shadow
			? {
					transform: 'translate(-2px, -2px)',
					boxShadow: 'var(--tt-shadow-hard-lg, 8px 8px 0 #1a1a1a)'
				}
			: {})
	};

	return (
		<Box
			as={href ? 'a' : 'button'}
			href={href}
			target={target}
			rel={rel}
			onClick={onClick}
			display="inline-flex"
			alignItems="center"
			justifyContent="center"
			gap="8px"
			fontFamily="var(--tt-font-display, inherit)"
			fontWeight={800}
			fontSize="15px"
			padding="13px 20px"
			border="var(--tt-border-w-chunky, 3px) solid var(--tt-ink, #1a1a1a)"
			boxShadow={shadow ? 'var(--tt-shadow-hard-sm, 5px 5px 0 #1a1a1a)' : 'none'}
			cursor="pointer"
			textDecoration="none"
			userSelect="none"
			transition="transform 120ms ease, box-shadow 120ms ease, background 120ms ease"
			{...variantStyle}
			_hover={hoverLift}
			{...props}
			{...chakras}
		>
			{children}
		</Box>
	);
};

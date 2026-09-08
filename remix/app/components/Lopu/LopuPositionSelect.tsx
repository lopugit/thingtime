import { Select } from '@chakra-ui/react';

import { LOPU_POSITIONS, LOPU_POSITION_LABELS, normalizeLopuPosition } from './lopuPosition';
import { useLopu } from './useLopu';
import { useLopuPosition } from './useLopuPosition';

// The dropdown behind Settings → Appearance → "Lopu messages" on both the
// /settings page and the drawer's quick-settings modal. Picking a corner fires
// a confirmation toast there, so the change is felt the moment it is made.
export const LopuPositionSelect = (props: { size?: 'xs' | 'sm' }) => {
	const { position, setPosition } = useLopuPosition();
	const lopu = useLopu();

	return (
		<Select
			size={props.size ?? 'sm'}
			aria-label="Where Lopu messages pop up"
			value={position}
			onChange={(event) => {
				const next = normalizeLopuPosition(event.target.value);
				setPosition(next);
				lopu({
					title: `Messages now pop up ${LOPU_POSITION_LABELS[next].toLowerCase()} ✨`,
					description: 'Every Lopu note lands here from now on.',
					status: 'success',
					duration: 4000
				});
			}}
			width="auto"
			minWidth="150px"
			background="var(--tt-surface-alt, #f5f5f7)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-sm, 9px)"
			iconColor="var(--tt-muted, #9a9aa6)"
		>
			{LOPU_POSITIONS.map((option) => (
				<option key={option} value={option}>
					{LOPU_POSITION_LABELS[option]}
				</option>
			))}
		</Select>
	);
};

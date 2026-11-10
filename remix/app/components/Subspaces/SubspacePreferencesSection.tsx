import React from 'react';
import { Select, Switch } from '@chakra-ui/react';

import { SettingRow, SettingsSection } from '~/components/Settings/SettingsSection';
import { SUBSPACE_SORTS, type SubspaceFeedSort } from './subspaceTypes';
import { useSubspacePrefs } from './useSubspacePrefs';

// Settings → Subspaces: the feature's user-facing knobs. Per-browser (sync
// localCache tier, tt-subspace-prefs) so they gate first paint without a
// server round-trip; every mounted card repaints live through the hook.

export const SubspacePreferencesSection = () => {
	const [prefs, setPrefs] = useSubspacePrefs();
	return (
		<SettingsSection eyebrow="Subspaces 🪐" description="Reddit-style communities. Up/down votes are a separate, focused reaction beside the emoji reactions — these switches only change what this browser shows.">
			<SettingRow label="Show up/down vote pills on posts" hint="Hides the ▲ score ▼ control everywhere; votes still count.">
				<Switch aria-label="Show up/down vote pills on posts" isChecked={prefs.showVotes} onChange={(event) => setPrefs({ showVotes: event.target.checked })} />
			</SettingRow>
			<SettingRow label="…and on comments" hint="Compact pills beside each comment's react button.">
				<Switch
					aria-label="Show up/down vote pills on comments"
					isChecked={prefs.showVotes && prefs.showVotesOnComments}
					isDisabled={!prefs.showVotes}
					onChange={(event) => setPrefs({ showVotesOnComments: event.target.checked })}
				/>
			</SettingRow>
			<SettingRow label="Default subspace sort" hint="The sort a subspace opens on when the link doesn't say.">
				<Select size="sm" width="170px" borderRadius="var(--tt-radius-md, 12px)" value={prefs.defaultSort} onChange={(event) => setPrefs({ defaultSort: event.target.value as SubspaceFeedSort })} aria-label="Default subspace sort">
					{SUBSPACE_SORTS.map((sort) => (
						<option key={sort.id} value={sort.id}>
							{sort.emoji} {sort.label}
						</option>
					))}
				</Select>
			</SettingRow>
		</SettingsSection>
	);
};

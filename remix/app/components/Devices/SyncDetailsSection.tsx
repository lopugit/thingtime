import React from 'react';
import { SettingsSection } from '../Settings/SettingsSection';

/** Read-heavy viewers exist only while explicitly expanded. Draft forms use
 * ordinary retained disclosures instead, so collapsing never clears input. */
export function SyncDetailsSection({ title, children }: { title: string; children: React.ReactNode }) {
 const [open, setOpen] = React.useState(false);
 return <SettingsSection eyebrow={title} open={open} onToggle={setOpen}>{open ? children : null}</SettingsSection>;
}

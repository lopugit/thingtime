import React from 'react';
import { SettingsSection } from '../Settings/SettingsSection';

/** Read-heavy viewers exist only while explicitly expanded. Draft forms use
 * ordinary retained disclosures instead, so collapsing never clears input. */
export function SyncDetailsSection({ title, children, retainChildren = false }: { title: string; children: React.ReactNode; retainChildren?: boolean }) {
 const [visited, setVisited] = React.useState(false);
 const [open, setOpen] = React.useState(false);
 return <SettingsSection eyebrow={title} open={open} onToggle={next => { setOpen(next); if (next) setVisited(true); }}>{open || (retainChildren && visited) ? children : null}</SettingsSection>;
}

import { validateThingtimeCrystal } from '../schemas/registry';
import type { WebpageBlock } from '../components/Builder/webpageBlocks';
export type SitePageDraft = { name: string; acl: string[]; blocks: WebpageBlock[]; baseUpdatedAt: string | null };
export function restoreSitePageDraft(raw: string, baseUpdatedAt: string | null): SitePageDraft {
 const value = JSON.parse(raw);
 if (!value || typeof value.name !== 'string' || !Array.isArray(value.acl) || value.acl.some(entry => typeof entry !== 'string') || !Array.isArray(value.blocks)) throw new Error('This page draft could not be restored. Its saved copy has been kept.');
 if (value.baseUpdatedAt !== baseUpdatedAt) throw new Error('The saved page changed since this draft. Its recovery copy has been kept; compare it before replacing the newer page.');
 const checked = validateThingtimeCrystal(['webpage'], { name: value.name || 'Page draft', blocks: value.blocks });
 if (!checked.ok) throw new Error('This page draft is invalid. Its saved copy has been kept.');
 return { name: value.name, acl: value.acl, blocks: checked.crystal.blocks as WebpageBlock[], baseUpdatedAt };
}

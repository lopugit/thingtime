import { bindSuiteComponentRefs } from '~/schemas/suiteComponentBindings';
import { materializeSuite } from '~/schemas/behaviourSuites';
import { SITE_FORMS_KEY, SITE_FORM_REFS, siteFormsSuite } from '~/schemas/siteFormsSuite';
import type { DemoBlock } from '~/schemas/webpageDemos';
import { suiteActionNames, suiteComponentsByRef } from './demoDetail';
import { installSuiteOnServer } from './installSuite';

const bundle = materializeSuite(siteFormsSuite, 'own');
export const siteDemoComponents = suiteComponentsByRef(bundle);
export const siteDemoActionNames = suiteActionNames(bundle);
export const installSiteDemoAction = async (action: string): Promise<boolean> => {
	if (!Object.prototype.hasOwnProperty.call(siteDemoActionNames, action)) return false;
	await installSuiteOnServer(SITE_FORMS_KEY, { onlyMissing: true });
	return true;
};
export const hasSiteDemoForms = (blocks: DemoBlock[]): boolean =>
	blocks.some(
		(block) => (block.type === 'component' && SITE_FORM_REFS.includes(block.component || '')) || (block.children && hasSiteDemoForms(block.children))
	);
export const installSiteDemoDependencies = async (blocks: DemoBlock[]): Promise<DemoBlock[]> => {
	if (!hasSiteDemoForms(blocks)) return blocks;
	const installed = await installSuiteOnServer(SITE_FORMS_KEY, { onlyMissing: true });
	const ids = Object.fromEntries(Object.entries(installed.componentIds).map(([key, id]) => [`demo-site-forms-${key}`, id]));
	return bindSuiteComponentRefs(blocks, ids);
};

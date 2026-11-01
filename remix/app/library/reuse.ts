import type { LibraryExample } from './types';
// Native actions prepare the input payload; remote execution remains an explicit
// Run in the isolated component. No secrets or executable source are persisted.
export function exampleThings(example: LibraryExample, suffix: string) {
	const key = `lib-${example.id}`.slice(0, 65) + `-${suffix.slice(0, 8)}`;
	const inputJson = JSON.stringify(example.input);
	return [
		{
			thingtime: ['data'],
			acl: ['tt:user'],
			crystal: {
				name: example.title,
				systemType: 'integration-example-v1',
				exampleId: example.id,
				provider: example.provider,
				input: example.input,
				docs: example.docs
			}
		},
		{
			thingtime: ['action'],
			acl: ['tt:user'],
			crystal: {
				name: `Prepare ${example.title}`,
				actionKey: key,
				description: `Prepare JSON inputs for ${example.provider}. Run the remote operation explicitly in the library component.`,
				category: 'Integrations',
				inputs: [{ name: 'inputJson', type: 'text', label: 'Example inputs (JSON)', default: inputJson, maxLength: 2000 }],
				steps: [{ op: 'return', value: { exampleId: example.id, inputJson: '$input.inputJson' } }],
				capabilities: [],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			}
		},
		{
			thingtime: ['component'],
			acl: ['tt:user'],
			crystal: {
				name: example.title,
				componentKey: key,
				description: `Editable ${example.provider} demo. External requests only run on an explicit click.`,
				category: 'Integrations',
				args: [{ name: 'inputJson', type: 'text', label: 'Inputs (JSON)', default: inputJson, maxLength: 2000 }],
				render: { chakra: 'IntegrationExample', props: { exampleId: example.id, inputJson: '{inputJson}' } }
			}
		}
	];
}

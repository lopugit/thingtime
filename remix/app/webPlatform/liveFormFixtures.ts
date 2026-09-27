import { base, parameter, recipe } from './programBuilders';
import type { Feature, PlatformNode, PlatformProgram, Recipe } from './types';

const node = (tag: string, attributes: Record<string, string | number | boolean> = {}, children: PlatformNode[] = []): PlatformNode => ({ tag, attributes, children });
const label = (id: string, text: string) => node('label', { for: id }, [text]);
const button = (id: string, text: string, type = 'button') => node('button', { id, type }, [text]);
const observe = (target: string, event: string) => ({ target, event: `${target}|${event}` });
const call = (method: string, trigger: string, args: unknown[] = []) => ({ target: '#sample', event: `#${trigger}|click`, method, args });

/** Live browser contexts, authored entirely as ordinary editable program data. */
export function liveFormRecipe(feature: Feature): Recipe | undefined {
	const reset = feature.name === 'HTMLFormElement.reset';
	const submit = ['HTMLFormElement.requestSubmit', 'SubmitEvent', 'SubmitEvent.submitter'].includes(feature.name);
	const validation = feature.interface === 'ValidityState' && ['badInput', 'tooLong', 'tooShort'].includes(feature.member || '');
	const formValidation = feature.interface === 'HTMLFormElement' && ['checkValidity', 'reportValidity'].includes(feature.member || '');
	if (!reset && !submit && !validation && !formValidation) return;
	const program: PlatformProgram = { ...base(feature), allowFormEvents: true,
		styles: [
			{ selector: 'form', declarations: { display: 'grid', gap: '8px', padding: '12px' } },
			{ selector: '.buttons', declarations: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
			{ selector: 'input, textarea, select, button', declarations: { font: 'inherit', 'max-width': '100%', 'box-sizing': 'border-box' } }
		]
	};
	if (reset) {
		program.description = 'Edit the text, message, checkbox and choice inside the preview, then reset to your authored defaults.';
		program.parameters = [parameter('text', 'Default text', 'Initial rainbow 🌈')];
		program.document = [node('form', { id: 'sample' }, [
			label('text', 'Editable text'), node('input', { id: 'text', name: 'text', value: '[[text]]' }),
			label('message', 'Editable message'), node('textarea', { id: 'message', name: 'message', rows: 2 }, ['[[text]]']),
			node('label', {}, [node('input', { id: 'checked', type: 'checkbox', checked: true }), 'Enabled by default']),
			label('choice', 'Default choice'), node('select', { id: 'choice' }, [
				node('option', { value: 'one' }, ['First']), node('option', { value: 'two', selected: true }, ['Second'])
			]),
			// Deliberately exercises standard form named-property shadowing.
			button('reset', 'Reset form')
		])];
		program.dom = [observe('#sample', 'reset'), call('reset', 'reset')];
	} else if (submit || formValidation) {
		program.description = 'Enter a name in the preview. Compare native validation with a valid submission and inspect its real submitter. Submission navigation is canceled.';
		program.parameters = [parameter('text', 'Initial name', ''), parameter('intent', 'Submitter value', 'save')];
		program.document = [node('form', { id: 'sample' }, [
			label('text', 'Required name'), node('input', { id: 'text', name: 'name', value: '[[text]]', required: true }),
			node('div', { class: 'buttons' }, [
				node('button', { id: 'send', type: 'submit', name: 'intent', value: '[[intent]]' }, ['Submit with this button']),
				node('button', { id: 'publish', type: 'submit', name: 'intent', value: 'publish' }, ['Submit with another button']),
				button('requestSubmit', 'Request submission'),
				button('checkValidity', 'Check validity'), button('reportValidity', 'Report validity')
			])
		])];
		program.dom = [observe('#sample', 'submit'), observe('#text', 'invalid'),
			call('requestSubmit', 'requestSubmit', [{ op: 'element', selector: '#send' }]),
			call('checkValidity', 'checkValidity'), call('reportValidity', 'reportValidity')];
	} else {
		const member = feature.member!;
		const help = member === 'badInput' ? 'Type an incomplete number such as a minus sign into the preview, then check validity.'
			: member === 'tooLong' ? 'Type more characters than your configured maximum into the preview, then apply that limit and check validity.'
				: 'Type fewer characters than your configured minimum into the preview, then check validity.';
		program.description = `${help} The event receipt reads the real user-edited control validity.`;
		if (member !== 'badInput') program.parameters = [parameter('limit', member === 'tooLong' ? 'Maximum length' : 'Minimum length', member === 'tooLong' ? 3 : 8, 'number')];
		program.document = [node('form', { id: 'sample' }, [
			node('p', {}, [help]), label('text', 'User-edited value'),
			node('input', { id: 'text', name: 'value', type: member === 'badInput' ? 'number' : 'text', ...(member === 'tooShort' ? { minlength: '[[limit]]' } : {}) }),
			...(member === 'tooLong' ? [button('limit', 'Apply maximum length')] : []),
			button('checkValidity', 'Check validity')
		])];
		program.dom = [observe('#text', 'input'), observe('#text', 'invalid'), call('checkValidity', 'checkValidity'),
			...(member === 'tooLong' ? [{ target: '#text', event: '#limit|click', method: 'setAttribute', args: ['maxlength', '[[limit]]'] }] : [])];
	}
	return recipe(program, 'interactive', program.description);
}

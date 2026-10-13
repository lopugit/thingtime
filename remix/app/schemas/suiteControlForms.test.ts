import assert from 'node:assert/strict';
import test from 'node:test';
import { getBehaviourSuite, materializeSuite } from './behaviourSuites';
import { resolveTemplate } from '../components/ComponentsLibrary/componentTemplate';

const nodes = (value: unknown): any[] =>
	!value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...Object.values(value).flatMap(nodes)];

test('guestbook Action inputs are editable native fields with server constraints', () => {
	const suite = getBehaviourSuite('guestbook')!;
	const component = materializeSuite(suite, 'own').components.find((part) => part.key === 'signer')!;
	const tree = resolveTemplate(component.crystal.render, { name: 'Ada', message: 'Hello', mood: 'happy' });
	const fields = nodes(tree).filter((node) => ['input', 'select', 'textarea'].includes(node.tag));
	assert.deepEqual(
		fields.map((node) => node.props.name),
		['name', 'message', 'mood']
	);
	assert.equal(fields[0].props.required, true);
	assert.equal(fields[0].props.maxLength, 80);
	assert.equal(fields[2].tag, 'select');
	assert.equal(component.crystal.version, 2);
});

test('RSVP choice buttons preserve their fixed answers rather than a shared field overriding them', () => {
	const component = materializeSuite(getBehaviourSuite('rsvp')!, 'own').components[0];
	const tree = nodes(component.crystal.render);
	assert.equal(
		tree.some((node) => node.props?.name === 'attending'),
		false
	);
	const answers = tree.filter((node) => node.ttAction?.endsWith('-reply')).map((node) => node.ttActionInputs.attending);
	assert.deepEqual(answers.sort(), ['maybe', 'no', 'yes']);
});


test('video controls appear only after a nonempty URL is provided', () => {
  const component = materializeSuite(getBehaviourSuite('site-forms')!, 'own').components.find(part => part.key === 'media')!;
  assert.equal(nodes(resolveTemplate(component.crystal.render, { mediaUrl: '' })).some(node => node.tag === 'video'), false);
  const video = nodes(resolveTemplate(component.crystal.render, { mediaUrl: 'https://example.test/video.mp4' })).find(node => node.tag === 'video');
  assert.equal(video.props.src, 'https://example.test/video.mp4');
  assert.equal(video.props.controls, true);
});

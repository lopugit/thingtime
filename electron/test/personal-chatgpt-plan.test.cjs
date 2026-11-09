'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { personalChatGPTPlanOwner } = require('../lib/personal-chatgpt-plan.cjs');

test('new device plan enrollment is off by default and confined to one configured owner and HTTPS account origin', () => {
  const environment = {
    THINGTIME_DESKTOP_PERSONAL_CHATGPT_PLAN_OWNER: 'personal-owner',
    THINGTIME_DESKTOP_PERSONAL_CHATGPT_PLAN_ORIGIN: 'https://owner.test'
  };
  assert.equal(personalChatGPTPlanOwner({}, 'https://owner.test'), null);
  assert.equal(personalChatGPTPlanOwner(environment, 'https://owner.test/settings'), 'personal-owner');
  assert.equal(personalChatGPTPlanOwner(environment, 'http://owner.test'), null);
  assert.equal(personalChatGPTPlanOwner(environment, 'https://other.test'), null);
  assert.equal(personalChatGPTPlanOwner(environment, 'https://login:secret@owner.test'), null);
  assert.equal(personalChatGPTPlanOwner({ ...environment, THINGTIME_DESKTOP_PERSONAL_CHATGPT_PLAN_ORIGIN: 'https://owner.test/' }, 'https://owner.test'), null);
  assert.equal(personalChatGPTPlanOwner({ ...environment, THINGTIME_DESKTOP_PERSONAL_CHATGPT_PLAN_OWNER: '*' }, 'https://owner.test'), null);
});

'use strict';

// Personal use requires an explicit on-device launch configuration. A release
// build or selected cloud account alone never enables unapproved distribution.
function personalChatGPTPlanOwner(environment, endpoint) {
  const owner = environment.THINGTIME_DESKTOP_PERSONAL_CHATGPT_PLAN_OWNER;
  const origin = environment.THINGTIME_DESKTOP_PERSONAL_CHATGPT_PLAN_ORIGIN;
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(owner) || typeof origin !== 'string') return null;
  try {
    const selected = new URL(endpoint);
    return selected.protocol === 'https:' && selected.origin === origin && !selected.username && !selected.password ? owner : null;
  } catch { return null; }
}

module.exports = { personalChatGPTPlanOwner };

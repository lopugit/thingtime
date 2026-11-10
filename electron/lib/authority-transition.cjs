'use strict';

class AuthorityTransition {
 constructor() { this.active = false; this.restarting = false; }
 async run(operation) {
  if (this.active) throw new Error('Finish the current workspace or API change before starting another.');
  this.active = true;
  try { return await operation(); }
  finally { if (!this.restarting) this.active = false; }
 }
 retainUntilRestart() { this.restarting = true; this.active = true; }
}
module.exports = { AuthorityTransition };

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isGatewayWorkIdle, reserveGatewayWorkShutdown, withGatewayWork } from '../deployment/environmentGateway';
import { screenTextForCreate } from './analyzeText';

function schedulingStatement(file: string, call: string) {
  const url = new URL(file, import.meta.url);
  const source = ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
  const candidates: string[] = [];
  const callbackDeclaration = (node: ts.Node, name: string): string | null => {
    // Resolve the real lexical callback, not an unrelated same-name function
    // elsewhere in the file. Execute its source with the scheduling statement
    // so the existing pending/rejected-effect assertions still test behavior.
    for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
          const initializer = declaration.initializer;
          return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && initializer.getText(source).includes(call)
            ? statement.getText(source) : null;
        }
      }
    }
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node)) {
      const text = node.getText(source);
      if (text.includes(call) && text.includes('withGatewayWork')) candidates.push(text);
      else {
        const findHoisted = (child: ts.Node) => {
          if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'withGatewayWork') {
            const callback = child.arguments[0];
            if (callback && ts.isIdentifier(callback)) {
              const declaration = callbackDeclaration(child, callback.text);
              if (declaration) candidates.push(`${declaration}\n${text}`);
            }
          }
          ts.forEachChild(child, findHoisted);
        };
        findHoisted(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const found = candidates.sort((a, b) => a.length - b.length)[0];
  assert(found, `Missing tracked scheduling boundary: ${file} / ${call}`);
  return ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}
const fixtures = [
  { file: './analyzeAttachment.ts', call: 'analyzeReadyAttachment(shareId)', effect: 'analyzeReadyAttachment' },
  { file: './analyzeText.ts', call: 'analyzeTextThing(shareId)', effect: 'analyzeTextThing' },
  { file: '../things/things.ts', call: 'emitCreationNotifications(doc, target', effect: 'emitCreationNotifications' },
  { file: '../auth/registerUser.ts', call: 'sendVerificationEmail(', effect: 'sendVerificationEmail' },
  { file: '../auth/serviceAccounts.ts', call: 'sendVerificationEmail(', effect: 'sendVerificationEmail' },
  { file: '../../../routes/api/v1/auth/password-reset/_password-reset.tsx', call: 'sendPasswordResetEmail(', effect: 'sendPasswordResetEmail' },
  { file: '../../../routes/api/v1/auth/verify-email/_verify-email.tsx', call: 'sendNewUserAdminNotification(', effect: 'sendNewUserAdminNotification' },
  { file: '../../../routes/api/v1/auth/resend-verification/_resend-verification.tsx', call: 'sendVerificationEmail(', effect: 'sendVerificationEmail' },
  { file: '../migrations/migrationDiagnostics.ts', call: 'pruneOldDiagnostics(ownerId)', effect: 'pruneOldDiagnostics' },
  { file: '../backups/backupWorkspace.server.ts', call: 'backupDispatcher.dispatch(id,origin)', effect: 'kick' }
];
// Execute actual source boundaries with controlled dependencies. Domain ACL and
// mutation behavior remain covered by their existing fixtures; these isolate
// nonblocking lifetime and swallowed failures without real account data.
for (const fixture of fixtures) for (const rejected of [false, true]) {
  test(`${fixture.file} tracks detached ${rejected ? 'failure' : 'completion'}`, async () => {
    let finish!: () => void, calls = 0;
    const pending = new Promise<void>((resolve, reject) => { finish = () => rejected ? reject(new Error('synthetic failure')) : resolve(); });
    const effect = () => { calls++; return pending; };
    const user = { id: 'synthetic-owner', email: 'synthetic@example.test', _id: 'synthetic-owner', createdAt: new Date(0), accountKind: 'user' };
    const context: Record<string, unknown> = {
      withGatewayWork, shareId: 'synthetic-thing', ownerId: user.id, email: user.email,
      verificationLink: 'https://synthetic.example/verify', link: 'https://synthetic.example/verify',
      created: { user }, user, result: { userId: user.id }, request: {}, RESET_TTL_MINUTES: 30,
      resolveTrustedOrigin: () => 'https://synthetic.example', findUserById: async () => user,
      findThing: async () => ({ ownerId: user.id, targetId: null }), asViewer: (id: string) => ({ id }),
      safeErrorText: () => '', id: 'synthetic-job', origin: 'https://synthetic.example',
      backupDispatcher: { dispatch: effect }, waitUntil: (_task: Promise<unknown>) => {}, [fixture.effect]: effect
    };
    const execute = new Function(...Object.keys(context), schedulingStatement(fixture.file, fixture.call));
    assert.equal(isGatewayWorkIdle(), true);
    execute(...Object.values(context));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(isGatewayWorkIdle(), false);
    assert.equal(reserveGatewayWorkShutdown(), null);
    finish(); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(isGatewayWorkIdle(), true);
  });
}

for (const phase of ['settings', 'provider']) test(`moderation ${phase} task remains tracked beyond the response budget`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const choice = { kind: 'screen', provider: 'synthetic', model: 'synthetic', screen: async () => { if (phase === 'provider') await blocked; return { flagged: false }; } };
  try {
    const result = screenTextForCreate({ text: 'synthetic', imageUrls: [] }, {
      resolveText: (async () => { if (phase === 'settings') await blocked; return choice; }) as any,
      budgetMs: 25, breaker: { failures: 0, openUntil: 0 }
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    t.mock.timers.tick(25);
    assert.equal((await result).kind, 'unavailable');
    assert.equal(isGatewayWorkIdle(), false);
    assert.equal(reserveGatewayWorkShutdown(), null);
    finish(); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(isGatewayWorkIdle(), true);
  } finally { finish(); t.mock.timers.reset(); }
});

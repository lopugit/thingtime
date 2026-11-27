import { reconcileGatewayAliases } from './environment-gateway-policy.mjs';

// A working PR alias is replaced only after its immutable candidate passes the
// same transport checks. Rollback uses the captured incumbent, never a provider
// response's possibly ambiguous oldDeploymentId.
export async function promotePreviewAlias({ alias, deploymentId, read, assign, remove, verifyCandidate, verifyAlias, assertCurrent }) {
  try {
    await verifyCandidate();
    await assertCurrent();
    const previous = await read(alias);
    const previousId = previous?.deploymentId || null;
    await reconcileGatewayAliases({
      names: [alias], before: new Map([[alias, previous]]), deploymentId, read,
      assign: async (name, id) => {
        const currentId = (await read(name))?.deploymentId || null;
        if (id === deploymentId && currentId !== previousId) throw new Error('Preview alias changed before publication');
        if (id !== deploymentId && currentId !== deploymentId) throw new Error('Preview alias changed before rollback');
        try { await assign(name, id); }
        catch (error) { if ((await read(name))?.deploymentId !== id) throw error; }
      },
      remove: async name => {
        if ((await read(name))?.deploymentId !== deploymentId) throw new Error('Preview alias changed before rollback');
        try { await remove(name); }
        catch (error) { if (await read(name)) throw error; }
      },
      verify: async name => { await verifyAlias(name); await assertCurrent(); }
    });
    return { alias, oldDeploymentId: previousId };
  } catch (error) {
    // The enclosing publisher must not clean up an incumbent, concurrent
    // successor or uncertain candidate after a failed publication/rollback.
    error.preservePreviewAttempt = true;
    throw error;
  }
}

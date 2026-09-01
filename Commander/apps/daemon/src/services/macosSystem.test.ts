import { describe, expect, it } from 'vitest';
import { availableExtensions, extensionItems } from './catalog.js';
import { macosSystemExtensionId, macosSystemShortcuts, macosSystemShortcutURL } from './macosSystem.js';

describe('macOS System shortcut catalog', () => {
  it('indexes unique native System Settings destinations as System results', () => {
    const extensions = availableExtensions([], 'macos');
    const systemExtension = extensions.find((extension) => extension.id === macosSystemExtensionId);
    const items = extensionItems(extensions).filter((item) => item.extensionId === macosSystemExtensionId);

    expect(systemExtension).toBeDefined();
    expect(macosSystemShortcuts).toHaveLength(39);
    expect(items).toHaveLength(macosSystemShortcuts.length);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items.every((item) => item.kind === 'system')).toBe(true);
    expect(items.find((item) => item.commandName === 'open-accessibility-settings')).toMatchObject({
      title: 'Accessibility Settings',
      subtitle: 'macOS System',
      keywords: expect.arrayContaining(['accessibility', 'assistive access', 'system settings']),
    });
    expect(items.find((item) => item.commandName === 'open-displays-settings')).toMatchObject({
      title: 'Displays Settings',
      subtitle: 'macOS System',
      keywords: expect.arrayContaining(['display', 'monitor', 'resolution', 'system settings']),
    });
  });

  it('resolves only declared x-apple System Settings URLs', () => {
    expect(macosSystemShortcutURL('open-accessibility-settings')).toBe(
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
    );
    expect(macosSystemShortcutURL('open-displays-settings')).toBe(
      'x-apple.systempreferences:com.apple.Displays-Settings.extension',
    );
    expect(macosSystemShortcutURL('not-a-command')).toBeUndefined();
    expect(
      macosSystemShortcuts.every((shortcut) => shortcut.url.startsWith('x-apple.systempreferences:')),
    ).toBe(true);
  });

  it('keeps the macOS extension out of other platform catalogs', () => {
    expect(
      availableExtensions([], 'linux').some((extension) => extension.id === macosSystemExtensionId),
    ).toBe(false);
    expect(
      availableExtensions([], 'windows').some((extension) => extension.id === macosSystemExtensionId),
    ).toBe(false);
  });
});

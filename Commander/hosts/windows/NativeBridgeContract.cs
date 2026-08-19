namespace Thingtime.Commander;

public sealed record NativeRequest(string Id, string Method, object? Params);
public sealed record NativeResponse(string Id, bool Ok, object? Result = null, string? Error = null);
public sealed record NativeSettingsSnapshot(
    string Hotkey,
    IReadOnlyDictionary<string, string> CommandShortcuts,
    bool OpenAtLogin,
    bool ShowMenuBarIcon,
    string WindowMode);
public sealed record CredentialKey(string Issuer, string ClientId, string AccountId);

public interface INativeBridge
{
    Task HideLauncherAsync();
    Task ShowLauncherAsync();
    Task CommandPresentationReadyAsync(string itemId);
    Task QuitApplicationAsync();
    Task BeginWindowDragAsync();
    Task BeginFileDragAsync(string path);
    Task<string?> GetFileIconDataUrlAsync(string path);
    Task OpenSettingsAsync(string? tab = null);
    Task OpenApplicationAsync(string pathOrUrl);
    Task<string?> GetPasteTargetAsync();
    Task RevealAsync(string path);
    Task WriteClipboardAsync(string text);
    Task<object?> PasteClipboardAsync(string text);
    Task<string?> ChooseExtensionPathAsync();
    Task UpdateHotkeyAsync(string shortcut);
    Task UpdateCommandHotkeysAsync(IReadOnlyDictionary<string, string> shortcuts);
    Task UpdateLaunchAtLoginAsync(bool enabled);
    Task UpdateTrayIconAsync(bool enabled);
    Task ApplyNativeSettingsAsync(NativeSettingsSnapshot settings);
    Task ClaimCredentialAsync(CredentialKey key);
    Task UnlockCredentialAsync(CredentialKey key);
    Task DeleteCredentialAsync(CredentialKey key);
}

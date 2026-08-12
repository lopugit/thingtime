namespace Thingtime.Commander;

public sealed record NativeRequest(string Id, string Method, object? Params);
public sealed record NativeResponse(string Id, bool Ok, object? Result = null, string? Error = null);
public sealed record NativeSettingsSnapshot(string Hotkey, bool OpenAtLogin, bool ShowMenuBarIcon, string WindowMode);
public sealed record CredentialKey(string Issuer, string ClientId, string AccountId);

public interface INativeBridge
{
    Task HideLauncherAsync();
    Task OpenSettingsAsync();
    Task OpenApplicationAsync(string pathOrUrl);
    Task RevealAsync(string path);
    Task WriteClipboardAsync(string text);
    Task<string?> ChooseExtensionPathAsync();
    Task UpdateHotkeyAsync(string shortcut);
    Task UpdateLaunchAtLoginAsync(bool enabled);
    Task UpdateTrayIconAsync(bool enabled);
    Task ApplyNativeSettingsAsync(NativeSettingsSnapshot settings);
    Task ClaimCredentialAsync(CredentialKey key);
    Task UnlockCredentialAsync(CredentialKey key);
    Task DeleteCredentialAsync(CredentialKey key);
}

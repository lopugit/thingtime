namespace Thingtime.Commander;

public sealed record NativeRequest(string Id, string Method, object? Params);
public sealed record NativeResponse(string Id, bool Ok, object? Result = null, string? Error = null);
public sealed record WindowPinningSettings(
    bool Enabled,
    bool DefaultPinned,
    bool FocusRecentOnCurrentDisplay,
    string Shortcut);
public sealed record LauncherWindowState(string WindowId, bool Pinned, bool PinningEnabled);
public sealed record NativeSettingsSnapshot(
    string Hotkey,
    IReadOnlyDictionary<string, string> CommandShortcuts,
    bool OpenAtLogin,
    bool ShowMenuBarIcon,
    string WindowMode,
    WindowPinningSettings WindowPinning,
    bool UseCustomWindowResizeHandling = true);
public sealed record CredentialKey(string Issuer, string ClientId, string AccountId);
public sealed record FullDiskAccessStatus(bool Granted);
public sealed record SystemMemoryBreakdown(
    long UsedBytes,
    long TotalBytes,
    long ActiveBytes,
    long WiredBytes,
    long CachedBytes,
    long CompressedBytes,
    long PurgeableBytes);
public sealed record FilesystemBreakdown(
    long UsedBytes,
    long TotalBytes,
    long AvailableBytes,
    long PurgeableBytes);
public sealed record SystemProcessMetric(
    int Pid,
    int ParentPid,
    string Name,
    double CpuPercent,
    long ResidentMemoryBytes,
    double DiskReadBytesPerSecond,
    double DiskWriteBytesPerSecond,
    double? NetworkBytesPerSecond,
    double? GpuPercent);
public sealed record SystemMetricsSnapshot(
    long SampledAtMs,
    double CommanderCpuPercent,
    long CommanderResidentMemoryBytes,
    long CommanderVirtualMemoryBytes,
    long CommanderStorageBytes,
    int CommanderProcessCount,
    double MachineCpuPercent,
    int LogicalCpuCount,
    long MachineMemoryUsedBytes,
    long MachineMemoryTotalBytes,
    string ThermalState,
    long FilesystemUsedBytes,
    long FilesystemTotalBytes,
    long FilesystemAvailableBytes,
    string GpuName,
    bool GpuAvailable,
    double? GpuUtilizationPercent,
    string GpuSource,
    SystemMemoryBreakdown? Memory = null,
    FilesystemBreakdown? Filesystem = null,
    IReadOnlyList<SystemProcessMetric>? Processes = null);

public interface INativeBridge
{
    Task HideLauncherAsync();
    Task ShowLauncherAsync();
    Task<LauncherWindowState> GetLauncherStateAsync();
    Task<LauncherWindowState> SetLauncherPinnedAsync(bool pinned);
    Task<LauncherWindowState> OpenNewLauncherWindowAsync();
    Task CommandPresentationReadyAsync(string itemId);
    Task QuitApplicationAsync();
    Task BeginWindowDragAsync();
    Task BeginFileDragAsync(string path);
    Task<string?> GetFileIconDataUrlAsync(string path);
    Task OpenSettingsAsync(string? tab = null);
    Task OpenApplicationAsync(string pathOrUrl);
    Task<string?> GetPasteTargetAsync();
    Task RevealAsync(string path);
    Task CopyFileAsync(string path);
    Task MoveToTrashAsync(string path);
    Task<bool> DeleteFileAsync(string path);
    Task WriteClipboardAsync(string text);
    Task<object?> PasteClipboardAsync(string text, bool preserveClipboard);
    Task<string?> ChooseExtensionPathAsync();
    Task UpdateHotkeyAsync(string shortcut);
    Task UpdateCommandHotkeysAsync(IReadOnlyDictionary<string, string> shortcuts);
    Task UpdateLaunchAtLoginAsync(bool enabled);
    Task UpdateTrayIconAsync(bool enabled);
    Task ApplyNativeSettingsAsync(NativeSettingsSnapshot settings);
    Task ClaimCredentialAsync(CredentialKey key);
    Task UnlockCredentialAsync(CredentialKey key);
    Task DeleteCredentialAsync(CredentialKey key);
    Task<SystemMetricsSnapshot> GetSystemMetricsAsync();
    Task<FullDiskAccessStatus> GetFullDiskAccessStatusAsync();
    Task ShowNotificationAsync(string id, string title, string body);
}

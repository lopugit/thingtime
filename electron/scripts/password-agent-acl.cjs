'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const checkAcl = String.raw`
$ErrorActionPreference = 'Stop'
try {
    $requested = [IO.Path]::GetFullPath($env:THINGTIME_PASSWORD_ACL_PATH)
    $userProfile = [IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)).TrimEnd([char]92)
    if ($userProfile -notmatch '^[A-Za-z]:\\' -or !($requested.Equals($userProfile, 'OrdinalIgnoreCase') -or $requested.StartsWith($userProfile + '\', 'OrdinalIgnoreCase'))) { exit 11 }
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $trusted = @($currentUser, 'S-1-5-18', 'S-1-5-32-544')
    for ($itemPath = $requested; ; $itemPath = [IO.Path]::GetDirectoryName($itemPath)) {
        $attributes = [IO.File]::GetAttributes($itemPath)
        if ($attributes -band [IO.FileAttributes]::ReparsePoint) { exit 12 }
        $acl = if ($attributes -band [IO.FileAttributes]::Directory) { [IO.Directory]::GetAccessControl($itemPath) } else { [IO.File]::GetAccessControl($itemPath) }
        $security = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
        if ($trusted -notcontains $security.Owner.Value -or $null -eq $security.DiscretionaryAcl) { exit 13 }
        foreach ($ace in $security.DiscretionaryAcl) {
            if ($ace.AceFlags -band [Security.AccessControl.AceFlags]::InheritOnly) { continue }
            if ($ace.AceType -eq [Security.AccessControl.AceType]::AccessDenied) { continue }
            if ($ace.AceType -ne [Security.AccessControl.AceType]::AccessAllowed -or $trusted -notcontains $ace.SecurityIdentifier.Value) { exit 14 }
        }
        if ($itemPath.Equals($userProfile, 'OrdinalIgnoreCase')) { exit 0 }
    }
} catch { exit 15 }
`;
const failure = {
  11: 'path outside the Windows profile', 12: 'reparse point in the path',
  13: 'untrusted owner or missing access list', 14: 'access granted to another principal',
  15: 'could not read the Windows access list',
};

async function requirePrivateWindowsPath(file) {
  if (process.platform !== 'win32') return;
  try {
    // Accept local, ordinary Win32 paths. Device paths, alternate streams and
    // trailing dots/spaces can address a different object through another API.
    if (!/^[a-z]:\\/i.test(file) || /[:/]/.test(file.slice(2)) || file.slice(3).split('\\').some(part => !part || /[. ]$/.test(part))) throw new Error();
    const windows = process.env.SystemRoot;
    if (!windows || !/^[a-z]:\\/i.test(windows)) throw new Error();
    const system32 = path.win32.join(windows, 'System32');
    const executable = path.win32.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(checkAcl, 'utf16le').toString('base64')], {
      env: { SystemRoot: windows, WINDIR: windows, PATH: system32, USERPROFILE: process.env.USERPROFILE,
        TEMP: process.env.TEMP, TMP: process.env.TMP, THINGTIME_PASSWORD_ACL_PATH: file }, windowsHide: true, timeout: 10000, maxBuffer: 8192,
    });
  } catch (error) {
    const reason = failure[error.code] || 'Windows access check unavailable';
    throw new Error(`Use a local path inside the current Windows user profile with access limited to that user and system administrators (${reason}).`);
  }
}

module.exports = { requirePrivateWindowsPath };

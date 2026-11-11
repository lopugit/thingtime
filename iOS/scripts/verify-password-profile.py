#!/usr/bin/env python3
"""Reject distribution profiles lacking the shared iOS credential-provider grant."""
import datetime
import fnmatch
import plistlib
import subprocess
import sys


def verify_profile(profile, identifier, team, host_identifier):
    entitlements = profile.get('Entitlements', {})
    assert entitlements.get('application-identifier') == team + '.' + identifier, 'Wrong App ID'
    assert entitlements.get('com.apple.developer.team-identifier') == team, 'Wrong team'
    assert entitlements.get('com.apple.developer.authentication-services.autofill-credential-provider') is True, 'Missing AutoFill capability'
    prefixes = profile.get('ApplicationIdentifierPrefix', [])
    assert len(prefixes) == 1 and isinstance(prefixes[0], str), 'Missing App ID prefix'
    group = prefixes[0] + '.' + host_identifier + '.passwords'
    assert any(fnmatch.fnmatchcase(group, allowed) for allowed in entitlements.get('keychain-access-groups', [])), 'Missing shared iOS password Keychain grant'
    assert not entitlements.get('get-task-allow', False), 'Development profile cannot distribute'
    expires = profile.get('ExpirationDate')
    assert expires and expires.replace(tzinfo=datetime.timezone.utc) > datetime.datetime.now(datetime.timezone.utc), 'Expired profile'


if __name__ == '__main__':
    try:
        decoded = subprocess.run(['security', 'cms', '-D', '-i', sys.argv[1]], check=True, capture_output=True)
        verify_profile(plistlib.loads(decoded.stdout), *sys.argv[2:5])
        print('Verified distribution AutoFill capability and isolated shared Keychain grant.')
    except Exception:
        sys.exit('Password provider signing profile is not ready. Enable AutoFill Credential Provider for both the app and extension, then regenerate their distribution profiles. No archive or upload was performed.')

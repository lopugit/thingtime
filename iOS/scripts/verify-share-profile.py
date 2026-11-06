#!/usr/bin/env python3
"""Fail closed before archive if the share profile lacks its existing App Group."""
import datetime
import plistlib
import subprocess
import sys


def verify_profile(profile, identifier, team, group):
    entitlements = profile.get('Entitlements', {})
    assert entitlements.get('application-identifier') == team + '.' + identifier, 'Wrong extension App ID'
    assert entitlements.get('com.apple.developer.team-identifier') == team, 'Wrong extension team'
    assert group in entitlements.get('com.apple.security.application-groups', []), 'Missing shared App Group'
    assert not entitlements.get('get-task-allow', False), 'Development profile cannot distribute'
    expires = profile.get('ExpirationDate')
    assert expires and expires.replace(tzinfo=datetime.timezone.utc) > datetime.datetime.now(datetime.timezone.utc), 'Expired extension profile'


if __name__ == '__main__':
    try:
        decoded = subprocess.run(['security', 'cms', '-D', '-i', sys.argv[1]], check=True, capture_output=True)
        verify_profile(plistlib.loads(decoded.stdout), *sys.argv[2:5])
        print('Verified share extension distribution profile and existing App Group.')
    except Exception:
        sys.exit('Share signing profile is not ready. Associate the share extension App ID with the existing Thingtime App Group through Xcode automatic signing or Apple Developer, then regenerate its App Store profile. No archive or upload was performed.')

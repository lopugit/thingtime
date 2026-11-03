#!/usr/bin/env python3
"""Verify the actual release app, Watch app and widget before upload."""
import os
import plistlib
from pathlib import Path


def verify_bundle(app, expected_build, bundle_id, team_id, check_signatures=True):
    import subprocess
    def read(path):
        with open(path, 'rb') as stream:
            return plistlib.load(stream)
    phone = read(app / 'Info.plist')
    targets = [
        (app, bundle_id),
        (app / 'Watch/ThingtimeWatch.app', bundle_id + '.watchkitapp'),
        (app / 'PlugIns/ThingtimeLopuWidget.appex', bundle_id + '.lopu-widget'),
        (app / 'PlugIns/ThingtimeShare.appex', bundle_id + '.share'),
    ]
    group = phone.get('ThingtimeWidgetGroup')
    assert isinstance(group, str) and group.startswith('group.') and '$' not in group, 'Missing resolved widget App Group'
    for target, identifier in targets:
        info = read(target / 'Info.plist')
        assert info['CFBundleIdentifier'] == identifier, 'Unexpected bundle identifier'
        assert str(info['CFBundleVersion']) == expected_build, 'Mismatched release build number'
        assert info['CFBundleShortVersionString'] == phone['CFBundleShortVersionString'], 'Mismatched marketing version'
        assert (target / info['CFBundleExecutable']).is_file(), 'Missing executable'
        if target.suffix == '.appex':
            expected_point = 'com.apple.share-services' if identifier.endswith('.share') else 'com.apple.widgetkit-extension'
            assert info['NSExtension']['NSExtensionPointIdentifier'] == expected_point, 'Wrong extension point'
            assert info.get('ThingtimeWidgetGroup') == group, 'Extension App Group differs from host'
            if identifier.endswith('.share'):
                assert info.get('CFBundleDisplayName') == 'Thingtime', 'Wrong share extension display name'
                attributes = info['NSExtension'].get('NSExtensionAttributes', {})
                rule = attributes.get('NSExtensionActivationRule')
                assert isinstance(rule, str) and 'TRUEPREDICATE' not in rule and 'registeredTypeIdentifiers' not in rule, 'Invalid production share activation rule'
                assert '$item.attachments.@count > 0' in rule and '$item.attributedContentText.length > 0' in rule, 'Missing broad file/text activation'
                assert info['NSExtension'].get('NSExtensionPrincipalClass', '').endswith('.ShareViewController'), 'Missing share extension controller'
        if check_signatures:
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(target)], check=True, capture_output=True)
            signed = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(target)], check=True, capture_output=True)
            entitlements = plistlib.loads(signed.stdout)
            assert entitlements.get('com.apple.developer.team-identifier') == team_id, 'Wrong signing team'
            assert entitlements.get('application-identifier') == team_id + '.' + identifier, 'Wrong signed application identity'
            assert not entitlements.get('get-task-allow', False), 'Development signing is not a release'
            if target == app or target.suffix == '.appex':
                assert group in entitlements.get('com.apple.security.application-groups', []), 'Missing signed App Group'
    return True


if __name__ == '__main__':
    import sys
    try:
        verify_bundle(Path(sys.argv[1]), os.environ['EXPECTED_BUILD_NUMBER'], os.environ['PRODUCT_BUNDLE_IDENTIFIER'], os.environ['DEVELOPMENT_TEAM'])
        print('Verified phone, Watch, widget and share release bundles and signed App Groups.')
    except Exception:
        # Do not log subprocess errors or signing data.
        sys.exit('Release package verification failed; upload is blocked.')

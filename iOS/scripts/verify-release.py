#!/usr/bin/env python3
"""Verify the actual release app, Watch app and widget before upload."""
import hashlib
import os
import plistlib
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def verify_release_testing_profile(profile, identifier, team_id, device_digest, certificate, production_push):
    entitlements = profile['Entitlements']
    assert profile['ExpirationDate'].replace(tzinfo=timezone.utc) > datetime.now(timezone.utc), 'Expired profile'
    assert not profile.get('ProvisionsAllDevices', False), 'Enterprise profile is not device scoped'
    devices = profile.get('ProvisionedDevices', [])
    assert len(devices) == 1 and hashlib.sha256(devices[0].lower().encode()).hexdigest() == device_digest, 'Unexpected profile devices'
    assert entitlements.get('application-identifier') == team_id + '.' + identifier, 'Wrong profile application identity'
    assert entitlements.get('com.apple.developer.team-identifier') == team_id, 'Wrong profile team'
    assert not entitlements.get('get-task-allow', False), 'Development profile is not a release'
    assert profile['DeveloperCertificates'] == [certificate], 'Profile does not authorize the signing certificate'
    if production_push:
        assert entitlements.get('aps-environment') == 'production', 'Profile lacks production APNs'


def verify_bundle(app, expected_build, bundle_id, team_id, check_signatures=True, device_digest=None, watch_device_digest=None):
    assert bool(device_digest) == bool(watch_device_digest), "Both device digests are required for Release testing"
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
            if device_digest:
                watch_target = identifier.endswith('.watchkitapp')
                production_push = target == app or watch_target
                if production_push:
                    assert entitlements.get('aps-environment') == 'production', 'Signed bundle lacks production APNs'
                    assert entitlements.get('com.apple.developer.usernotifications.time-sensitive') is True, 'Missing signed time-sensitive notifications'
                if target == app:
                    assert 'webcredentials:thingtime.com' in entitlements.get('com.apple.developer.associated-domains', []), 'Missing credential association'
                    assert phone['ThingtimeWebURL'] == 'https://thingtime.com', 'Wrong Release origin'
                default_keychain = team_id + '.' + identifier
                keychain_groups = set(entitlements.get('keychain-access-groups', [default_keychain]))
                assert default_keychain in keychain_groups <= {default_keychain, 'com.apple.token'}, 'Unexpected signed keychain groups'
                decoded = subprocess.run(['security', 'cms', '-D', '-i', str(target / 'embedded.mobileprovision')], check=True, capture_output=True)
                with tempfile.TemporaryDirectory(prefix='thingtime-signing-cert-') as directory:
                    prefix = Path(directory) / 'signer'
                    subprocess.run(['codesign', '-d', f'--extract-certificates={prefix}', str(target)], check=True, capture_output=True)
                    certificate = Path(str(prefix) + '0').read_bytes()
                profile = plistlib.loads(decoded.stdout)
                target_digest = watch_device_digest if watch_target else device_digest
                verify_release_testing_profile(profile, identifier, team_id, target_digest, certificate, production_push)
            if target == app or target.suffix == '.appex':
                assert group in entitlements.get('com.apple.security.application-groups', []), 'Missing signed App Group'
                if device_digest:
                    assert group in profile['Entitlements'].get('com.apple.security.application-groups', []), 'Profile lacks the shared App Group'
    return True


if __name__ == '__main__':
    import sys
    try:
        verify_bundle(Path(sys.argv[1]), os.environ['EXPECTED_BUILD_NUMBER'], os.environ['PRODUCT_BUNDLE_IDENTIFIER'], os.environ['DEVELOPMENT_TEAM'], device_digest=os.environ.get('IOS_RELEASE_TESTING_DEVICE_SHA256'),
                      watch_device_digest=os.environ.get('WATCH_RELEASE_TESTING_DEVICE_SHA256'))
        print('Verified phone, Watch, widget and share release bundles and signed App Groups.')
        if os.environ.get('IOS_RELEASE_TESTING_DEVICE_SHA256'):
            print('Verified exact device profile, signing certificate, production APNs and origin.')
    except Exception:
        # Do not log subprocess errors or signing data.
        sys.exit('Release package verification failed; distribution is blocked.')

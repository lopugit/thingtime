import importlib.util
import plistlib
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('verify-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

profile_spec = importlib.util.spec_from_file_location('share_profile', Path(__file__).with_name('verify-share-profile.py'))
share_profile = importlib.util.module_from_spec(profile_spec)
profile_spec.loader.exec_module(share_profile)

password_spec = importlib.util.spec_from_file_location('password_profile', Path(__file__).with_name('verify-password-profile.py'))
password_profile = importlib.util.module_from_spec(password_spec)
password_spec.loader.exec_module(password_profile)

class PasswordProfileTests(unittest.TestCase):
    def test_autofill_and_shared_keychain_are_required(self):
        import datetime
        profile = dict(ExpirationDate=datetime.datetime.now() + datetime.timedelta(days=1), ApplicationIdentifierPrefix=['EXAMPLETEAM'], Entitlements={
            'application-identifier': 'EXAMPLETEAM.com.example.app.password-provider',
            'com.apple.developer.team-identifier': 'EXAMPLETEAM',
            'com.apple.developer.authentication-services.autofill-credential-provider': True,
            'keychain-access-groups': ['EXAMPLETEAM.*'],
        })
        password_profile.verify_profile(profile, 'com.example.app.password-provider', 'EXAMPLETEAM', 'com.example.app')
        for key, value in [('com.apple.developer.authentication-services.autofill-credential-provider', False), ('keychain-access-groups', ['EXAMPLETEAM.com.thingtime.passwords'])]:
            original = profile['Entitlements'][key]; profile['Entitlements'][key] = value
            with self.assertRaises(AssertionError):
                password_profile.verify_profile(profile, 'com.example.app.password-provider', 'EXAMPLETEAM', 'com.example.app')
            profile['Entitlements'][key] = original

class ShareProfileTests(unittest.TestCase):
    def test_shared_group_required_for_distribution(self):
        import datetime
        profile = dict(ExpirationDate=datetime.datetime.now() + datetime.timedelta(days=1), Entitlements={
            'application-identifier': 'EXAMPLETEAM.com.example.app.share',
            'com.apple.developer.team-identifier': 'EXAMPLETEAM',
            'com.apple.security.application-groups': ['group.example'],
        })
        share_profile.verify_profile(profile, 'com.example.app.share', 'EXAMPLETEAM', 'group.example')
        profile['Entitlements']['com.apple.security.application-groups'] = []
        with self.assertRaises(AssertionError):
            share_profile.verify_profile(profile, 'com.example.app.share', 'EXAMPLETEAM', 'group.example')

class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'Thingtime.app'
        for relative, identifier in [('', 'com.example.app'), ('Watch/ThingtimeWatch.app', 'com.example.app.watchkitapp'), ('PlugIns/ThingtimeLopuWidget.appex', 'com.example.app.lopu-widget'), ('PlugIns/ThingtimeShare.appex', 'com.example.app.share'), ('PlugIns/ThingtimePasswordProvider.appex', 'com.example.app.password-provider')]:
            target = self.app / relative
            target.mkdir(parents=True)
            info = dict(CFBundleIdentifier=identifier, CFBundleVersion='32', CFBundleShortVersionString='1.0', CFBundleExecutable='Executable', ThingtimeWidgetGroup='group.example', ThingtimePasswordKeychainGroup='EXAMPLETEAM.com.example.app.passwords')
            if relative.startswith('PlugIns'):
                info['NSExtension'] = dict(NSExtensionPointIdentifier='com.apple.widgetkit-extension')
            if identifier.endswith('.share'):
                info['CFBundleDisplayName'] = 'Thingtime'
                info['NSExtension'] = dict(NSExtensionPointIdentifier='com.apple.share-services', NSExtensionPrincipalClass='ThingtimeShare.ShareViewController', NSExtensionAttributes=dict(NSExtensionActivationRule='SUBQUERY(extensionItems, $item, $item.attachments.@count > 0 OR $item.attributedContentText.length > 0).@count > 0'))
            if identifier.endswith('.password-provider'):
                info['NSExtension'] = dict(NSExtensionPointIdentifier='com.apple.authentication-services-credential-provider-ui', NSExtensionPrincipalClass='ThingtimePasswordProvider.CredentialProviderViewController', NSExtensionAttributes=dict(ASCredentialProviderExtensionCapabilities=dict(ProvidesPasswords=True, ProvidesPasskeys=True, ProvidesOneTimeCodes=True)))
            (target / 'Executable').touch()
            (target / 'Info.plist').write_bytes(plistlib.dumps(info))
    def verify(self):
        return release.verify_bundle(self.app, '32', 'com.example.app', 'EXAMPLETEAM', check_signatures=False)
    def test_complete_bundle(self):
        self.assertTrue(self.verify())
    def test_missing_provider_is_rejected(self):
        (self.app / 'PlugIns/ThingtimePasswordProvider.appex/Executable').unlink()
        with self.assertRaises(AssertionError): self.verify()
    def test_foreign_password_group_is_rejected(self):
        path = self.app / 'PlugIns/ThingtimePasswordProvider.appex/Info.plist'
        info = plistlib.loads(path.read_bytes()); info['ThingtimePasswordKeychainGroup'] = 'EXAMPLETEAM.com.thingtime.passwords'
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaises(AssertionError): self.verify()
    def test_missing_provider_capability_is_rejected(self):
        path = self.app / 'PlugIns/ThingtimePasswordProvider.appex/Info.plist'
        info = plistlib.loads(path.read_bytes()); del info['NSExtension']['NSExtensionAttributes']['ASCredentialProviderExtensionCapabilities']['ProvidesPasskeys']
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaises(AssertionError): self.verify()
    def test_missing_widget_is_rejected(self):
        (self.app / 'PlugIns/ThingtimeLopuWidget.appex/Executable').unlink()
        with self.assertRaises(AssertionError): self.verify()
    def test_missing_share_is_rejected(self):
        (self.app / 'PlugIns/ThingtimeShare.appex/Executable').unlink()
        with self.assertRaises(AssertionError): self.verify()
    def test_share_development_predicate_is_rejected(self):
        path = self.app / 'PlugIns/ThingtimeShare.appex/Info.plist'
        info = plistlib.loads(path.read_bytes())
        info['NSExtension']['NSExtensionAttributes']['NSExtensionActivationRule'] = 'TRUEPREDICATE'
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaises(AssertionError): self.verify()
    def test_wrong_build_is_rejected(self):
        path = self.app / 'Watch/ThingtimeWatch.app/Info.plist'
        info = plistlib.loads(path.read_bytes()); info['CFBundleVersion'] = '31'; path.write_bytes(plistlib.dumps(info))
        with self.assertRaises(AssertionError): self.verify()
    def test_wrong_group_is_rejected(self):
        path = self.app / 'PlugIns/ThingtimeLopuWidget.appex/Info.plist'
        info = plistlib.loads(path.read_bytes()); info['ThingtimeWidgetGroup'] = 'group.other'; path.write_bytes(plistlib.dumps(info))
        with self.assertRaises(AssertionError): self.verify()
if __name__ == '__main__': unittest.main()

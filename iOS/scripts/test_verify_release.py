import importlib.util
import plistlib
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('verify-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'Thingtime.app'
        for relative, identifier in [('', 'com.example.app'), ('Watch/ThingtimeWatch.app', 'com.example.app.watchkitapp'), ('PlugIns/ThingtimeLopuWidget.appex', 'com.example.app.lopu-widget')]:
            target = self.app / relative
            target.mkdir(parents=True)
            info = dict(CFBundleIdentifier=identifier, CFBundleVersion='32', CFBundleShortVersionString='1.0', CFBundleExecutable='Executable', ThingtimeWidgetGroup='group.example')
            if relative.startswith('PlugIns'):
                info['NSExtension'] = dict(NSExtensionPointIdentifier='com.apple.widgetkit-extension')
            (target / 'Executable').touch()
            (target / 'Info.plist').write_bytes(plistlib.dumps(info))
    def verify(self):
        return release.verify_bundle(self.app, '32', 'com.example.app', 'EXAMPLETEAM', check_signatures=False)
    def test_complete_bundle(self):
        self.assertTrue(self.verify())
    def test_missing_widget_is_rejected(self):
        (self.app / 'PlugIns/ThingtimeLopuWidget.appex/Executable').unlink()
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

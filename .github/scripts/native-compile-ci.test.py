#!/usr/bin/env python3
"""Non-privileged trusted-controller admission tests; never load candidate code."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name('native-compile-ci.py')
spec = importlib.util.spec_from_file_location('trusted_native_compile', HELPER)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeCompileBoundaryTests(unittest.TestCase):
    def environment(self):
        return {'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','RUNNER_OS':'macOS',
                'GITHUB_REPOSITORY':'lopugit/thingtime','GITHUB_REF':'refs/heads/github-actions',
                'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_ACTOR':'lopugit',
                'GITHUB_WORKFLOW_REF':'lopugit/thingtime/.github/workflows/native-compile.yml@refs/heads/github-actions',
                'SUDO_UID':'501','SUDO_USER':'runner'}

    def test_local_build_refuses_before_privileged_operations(self):
        result=subprocess.run([sys.executable,'-I','-S',str(HELPER),'build','a','b','c','d','e'],
                              env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('requires protected dispatch',result.stderr)

    def test_self_hosted_candidate_ref_nonowner_and_root_runner_are_rejected(self):
        valid=self.environment()
        self.assertEqual(native.require_hosted_runner(valid,lambda:'Darwin',lambda:0),(501,'runner'))
        for key,value in [('RUNNER_ENVIRONMENT','self-hosted'),('GITHUB_REF','refs/heads/codex/candidate'),
                          ('GITHUB_ACTOR','other'),('GITHUB_EVENT_NAME','pull_request'),('SUDO_UID','0'),
                          ('GITHUB_WORKFLOW_REF','candidate-controlled')]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                native.require_hosted_runner(dict(valid,**{key:value}),lambda:'Darwin',lambda:0)

    def test_workflow_pins_reviewed_helper_independently_of_candidate_and_caller(self):
        workflow=HELPER.parent.parent/'workflows/native-compile.yml'
        text=workflow.read_text()
        helper_sha='d0dfbdbc89f039cb45ccbd9c4e4e3054937942b8'
        self.assertIn('ref: '+helper_sha,text)
        self.assertIn('CONTROL_SHA: '+helper_sha,text)
        self.assertIn('test "$(git -C trusted-controller rev-parse HEAD)" = "$CONTROL_SHA"',text)
        self.assertNotIn('commits/github-actions',text)
        self.assertNotIn('ref: ${{ github.sha }}',text)
        self.assertNotIn('ref: ${{ github.workflow_sha }}',text)
        self.assertNotIn('steps.controller.outputs.sha',text)

    def test_source_identity_and_exact_sha_are_required(self):
        sha='a'*40
        pr={'state':'open','author_association':'OWNER','head':{'repo':{'full_name':'lopugit/thingtime'},'sha':sha},
            'base':{'repo':{'full_name':'lopugit/thingtime'}}}
        self.assertEqual(native.validate_source(pr,sha),sha)
        for key,value in [('state','closed'),('author_association','MEMBER'),('head',{'repo':{'full_name':'fork/thingtime'},'sha':sha})]:
            with self.subTest(key=key),self.assertRaises(ValueError):native.validate_source(dict(pr,**{key:value}),sha)
        with self.assertRaises(ValueError):native.validate_source(pr,'b'*40)
        with self.assertRaises(ValueError):native.validate_source(pr,sha+'; echo unsafe')

    def test_all_protocols_and_both_address_families_are_denied(self):
        rules=native.firewall_rules(501).splitlines()
        self.assertEqual(len(rules),4)
        for family in ['inet','inet6']:
            self.assertIn(f'pass out quick {family} proto {{ tcp udp }} all user 501 keep state',rules)
            self.assertIn(f'block drop out quick {family} all',rules)
        self.assertTrue(all('user' not in r and 'proto' not in r for r in rules[2:]))
        for uid in [0,-1,'501\npass out all']:
            with self.assertRaises(ValueError):native.firewall_rules(uid)

    def make_archive(self,root,extras=()):
        archive=root/'candidate.tar.gz'
        required=['apple/Passwords/Package.swift','apple/FileSync/Package.swift','iOS/project.yml','macos/ThingtimePasswords/project.yml']
        with tarfile.open(archive,'w:gz') as stream:
            for path,data in [(p,b'fixture') for p in required]+list(extras):
                member=tarfile.TarInfo('repo-'+('a'*40)+'/'+path)
                if data is None:
                    member.type=tarfile.SYMTYPE;member.linkname='/tmp/escape'
                else:member.size=len(data)
                stream.addfile(member,io.BytesIO(data) if data is not None else None)
        return archive

    def test_candidate_helpers_and_sitecustomize_are_data_never_imported(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';source.mkdir();marker=root/'executed'
            poison=f'from pathlib import Path; Path({str(marker)!r}).touch()'.encode()
            archive=self.make_archive(root,[('.github/scripts/native-compile-ci.py',poison),
                                            ('scripts/native-compile-ci.py',poison),('iOS/sitecustomize.py',poison),
                                            ('iOS/subprocess.py',poison)])
            native.extract_candidate(archive,source)
            self.assertFalse((source/'.github').exists())
            self.assertFalse((source/'scripts').exists())
            # Even a candidate PYTHONPATH/cwd cannot inject the trusted
            # extractor's Python import context with the enforced -I -S flags.
            if os.geteuid()!=0:
                target=root/'isolated-extract';target.mkdir()
                subprocess.run([sys.executable,'-I','-S',str(HELPER),'extract',str(archive),str(target)],
                               cwd=source/'iOS',env={'PYTHONPATH':str(source/'iOS'),'PATH':'/usr/bin:/bin'},check=True)
            self.assertFalse(marker.exists())

    def test_archive_traversal_links_and_duplicates_are_rejected(self):
        for path,data in [('iOS/../../escape',b'x'),('iOS/link',None),('iOS/project.yml',b'duplicate')]:
            with self.subTest(path=path),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);source=root/'source';source.mkdir()
                archive=self.make_archive(root,[(path,data)])
                with self.assertRaises((ValueError,FileExistsError)):native.extract_candidate(archive,source)
                self.assertFalse((root/'escape').exists())

    def cleanup_state(self,root):
        (root/'cleanup.lock').touch()
        (root/'state.json').write_text(json.dumps({'uid':5500,'user':'_ttfixture','user_created':True,
                  'group_created':True,'pf_changed':True,'pf_token':'123'}))

    def test_cleanup_kills_descendants_before_network_restoration(self):
        calls=[]
        def fake(args,**kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args,1 if args[0]=='/usr/bin/pgrep' else 0,stdout='')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            with patch.object(native.subprocess,'run',side_effect=fake):native.cleanup(root)
            kill=next(i for i,c in enumerate(calls) if c[0]=='/usr/bin/pkill')
            gone=next(i for i,c in enumerate(calls) if c[0]=='/usr/bin/pgrep')
            restore=next(i for i,c in enumerate(calls) if c[:2]==['/sbin/pfctl','-f'])
            self.assertLess(kill,gone);self.assertLess(gone,restore)
            self.assertTrue((root/'cleaned').exists())

    def test_live_descendants_keep_network_denied(self):
        calls=[]
        def fake(args,**kwargs):
            calls.append(args);return subprocess.CompletedProcess(args,0,stdout='alive')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            with patch.object(native.subprocess,'run',side_effect=fake),patch.object(native.time,'sleep'),self.assertRaises(RuntimeError):
                native.cleanup(root)
            self.assertFalse(any(c[0]=='/sbin/pfctl' for c in calls))
            self.assertFalse((root/'cleaned').exists())


if __name__=='__main__':unittest.main()

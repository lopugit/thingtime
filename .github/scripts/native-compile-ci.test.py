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
from unittest.mock import patch, Mock

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
        helper_sha='d1f3a85b631b97d5514d7298712aafefb7858a1e'
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
        self.assertEqual(len(rules),6)
        for family in ['inet','inet6']:
            self.assertIn(f'pass out quick {family} proto tcp all user 501 flags any keep state',rules)
            self.assertIn(f'pass out quick {family} proto udp all user 501 keep state',rules)
            self.assertIn(f'block drop out quick {family} all',rules)
        self.assertTrue(all('user' not in r and 'proto' not in r for r in rules[4:]))
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
                  'group_created':True,'pf_changed':True,'pf_token':'123','owned_groups':[],'report':str(root)}))

    def test_cleanup_kills_descendants_before_network_restoration(self):
        calls=[]
        def fake(args,**kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args,1 if args[0]=='/usr/bin/pgrep' else 0,stdout='')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            with patch.object(native,'run',side_effect=fake),patch.object(native,'phase'):native.cleanup(root)
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
            with patch.object(native,'run',side_effect=fake),patch.object(native,'phase'),patch.object(native.time,'sleep'),patch.object(native.time,'monotonic',side_effect=iter(range(200))),self.assertRaises(RuntimeError):
                native.cleanup(root)
            self.assertFalse(any(c[0]=='/sbin/pfctl' for c in calls))
            self.assertFalse((root/'cleaned').exists())

    def test_actual_listener_and_worker_uid_must_both_match(self):
        rows='100 1 501 /runner/bin/Runner.Listener\n101 100 501 /runner/bin/Runner.Worker\n5 1 65 /usr/sbin/mDNSResponder\n'
        self.assertEqual(len(native.verify_runner_daemons(rows,501)),3)
        for bad in [rows.replace('101 100 501','101 100 0'), rows.splitlines()[0], rows.replace('501','bad'),rows.replace('5 1 65','5 1 501')]:
            with self.assertRaises(RuntimeError):native.verify_runner_daemons(bad,501)

    def test_timeout_kills_only_owned_group_and_bounds_reap(self):
        process=Mock(pid=123,stdout=None,stderr=None)
        process.communicate.side_effect=[subprocess.TimeoutExpired(['fixture'],.01),(None,None)]
        with patch.object(native.subprocess,'Popen',return_value=process) as launch,patch.object(native.os,'killpg') as kill:
            with self.assertRaises(subprocess.TimeoutExpired):native.run(['fixture'],timeout=.01)
        kill.assert_called_once_with(123,native.signal.SIGKILL)
        self.assertTrue(launch.call_args.kwargs['start_new_session'])
        self.assertTrue(launch.call_args.kwargs['close_fds'])
        self.assertEqual(process.communicate.call_args_list[-1].kwargs,{'timeout':5})

    def test_lock_wait_has_finite_fail_closed_deadline(self):
        with patch.object(native.fcntl,'flock',side_effect=BlockingIOError),patch.object(native.time,'monotonic',return_value=20):
            with self.assertRaises(TimeoutError):native.acquire_cleanup_lock(Mock(),10)

    def test_bootstrap_does_not_extend_for_inert_or_failed_native_gates(self):
        self.assertIsNone(native.native_deadline('preflight',True,10))
        with self.assertRaises(RuntimeError):native.native_deadline('native',False,10)
        with self.assertRaises(ValueError):native.native_deadline('unexpected',True,10)
        self.assertEqual(native.native_deadline('native',True,10),10+native.DEADLINE_SECONDS+native.CLEANUP_SECONDS)

    def test_failed_hostname_probe_fails_positive_gate_without_network_access(self):
        with patch('socket.create_connection',side_effect=OSError),patch.object(sys,'argv',['probe','allow']):
            with self.assertRaises(RuntimeError):exec(native.CONTROL_PROBE,{})
        output=io.StringIO()
        with patch('socket.create_connection',side_effect=OSError),patch.object(sys,'argv',['probe','deny']),patch('sys.stdout',output):
            exec(native.CONTROL_PROBE,{})
        self.assertTrue(json.loads(output.getvalue())['rootControlDenied'])

    def test_owned_probe_group_must_be_gone_before_restore(self):
        calls=[]
        def fake(args,**kwargs):
            calls.append(args);return subprocess.CompletedProcess(args,1 if args[0]=='/usr/bin/pgrep' else 0,stdout='')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            state=json.loads((root/'state.json').read_text());state['owned_groups']=[9001]
            (root/'state.json').write_text(json.dumps(state))
            with patch.object(native,'run',side_effect=fake),patch.object(native,'phase'),patch.object(native.os,'killpg',side_effect=[None,ProcessLookupError]) as kill:
                native.cleanup(root)
            self.assertEqual(kill.call_args_list[0].args,(9001,native.signal.SIGKILL))
            self.assertEqual(kill.call_args_list[1].args,(9001,0))
            self.assertTrue(any(c[:2]==['/sbin/pfctl','-f'] for c in calls))

    def test_lost_output_and_report_storage_do_not_prevent_cleanup_markers(self):
        with patch.object(Path,'open',side_effect=OSError),patch('builtins.print',side_effect=BrokenPipeError):
            native.phase(Path('/unused'),'cleanup-started')

    def test_live_owned_probe_group_keeps_network_denied(self):
        calls=[]
        def fake(args,**kwargs):
            calls.append(args);return subprocess.CompletedProcess(args,0,stdout='')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            state=json.loads((root/'state.json').read_text());state['owned_groups']=[9001]
            (root/'state.json').write_text(json.dumps(state))
            with patch.object(native,'run',side_effect=fake),patch.object(native,'phase'),patch.object(native.os,'killpg'),patch.object(native.time,'sleep'),patch.object(native.time,'monotonic',side_effect=iter(range(200))),self.assertRaises(RuntimeError):
                native.cleanup(root)
            self.assertFalse(any(c[0]=='/sbin/pfctl' for c in calls))

    def test_uid_admission_failure_records_no_policy_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            report=Path(directory)
            with patch.object(native,'run',return_value=subprocess.CompletedProcess([],0,stdout='')),patch.object(native,'phase'),self.assertRaises(RuntimeError):
                native.admit_runner(501,report,'a'*40,'b'*40,'preflight')
            result=json.loads((report/'result.json').read_text())
            self.assertFalse(result['policyChanged'])
            self.assertFalse(result['candidateExecuted'])

    def test_process_inventory_error_does_not_count_as_absence(self):
        calls=[]
        def fake(args,**kwargs):
            calls.append(args);return subprocess.CompletedProcess(args,2 if args[0]=='/usr/bin/pgrep' else 0,stdout='')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            with patch.object(native,'run',side_effect=fake),patch.object(native,'phase'),self.assertRaises(RuntimeError):
                native.cleanup(root)
            self.assertFalse(any(c[0]=='/sbin/pfctl' for c in calls))

    def test_numeric_identity_drop_clears_groups_and_verifies_real_and_effective_ids(self):
        events=[]
        with patch.object(native.os,'geteuid',side_effect=[0,5500]),patch.object(native.os,'getuid',return_value=5500),patch.object(native.os,'getgid',return_value=5500),patch.object(native.os,'getegid',return_value=5500),patch.object(native.os,'getgroups',return_value=[]),patch.object(native.os,'setgroups',side_effect=lambda v:events.append(('groups',v))),patch.object(native.os,'setgid',side_effect=lambda v:events.append(('gid',v))),patch.object(native.os,'setuid',side_effect=lambda v:events.append(('uid',v))),patch.object(native.os,'execv',side_effect=lambda *v:events.append(('exec',v))):
            native.drop_identity(5500,5500,['/usr/bin/true'])
        self.assertEqual([e[0] for e in events],['groups','gid','uid','exec'])
        with patch.object(native.os,'geteuid',return_value=0),patch.object(native.os,'setgroups'),patch.object(native.os,'setgid'),patch.object(native.os,'setuid'),patch.object(native.os,'getuid',return_value=0),patch.object(native.os,'execv') as execute,self.assertRaises(RuntimeError):
            native.drop_identity(5500,5500,['/usr/bin/true'])
        execute.assert_not_called()

    def test_metadata_distinguishes_zombie_live_and_escaped_groups_without_args(self):
        rows=native.process_inventory('10 1 5500 10 Z /usr/bin/python3\n11 1 5500 99 S /usr/bin/true\n')
        self.assertEqual([r['state'] for r in rows],['Z','S'])
        self.assertEqual(rows[1]['groupId'],99)
        self.assertEqual(set(rows[0]),{'pid','parentPid','uid','groupId','state','executable'})
        with self.assertRaises(RuntimeError):native.process_inventory('unparseable')

    def test_inherited_pipe_timeout_still_reaps_direct_child(self):
        process=Mock(pid=123,stdout=Mock(),stderr=Mock())
        process.communicate.side_effect=subprocess.TimeoutExpired(['fixture'],.01)
        with patch.object(native,'start_owned_command',return_value=process),patch.object(native.os,'killpg'),self.assertRaises(subprocess.TimeoutExpired):
            native.run(['fixture'],timeout=.01)
        process.wait.assert_called_once_with(timeout=5)
        process.stdout.close.assert_called_once()
        process.stderr.close.assert_called_once()

    def test_detached_watchdog_does_not_retain_parent_capture_pipes(self):
        # Only fixture fork/PID: no identity mutation, process scan or UID kill.
        with tempfile.TemporaryDirectory() as directory:
            script="import importlib.util,os,time; s=importlib.util.spec_from_file_location('n',%r); n=importlib.util.module_from_spec(s); s.loader.exec_module(n); p=os.fork(); (n.detach_watchdog_io(%r),time.sleep(2),os._exit(0)) if p==0 else print(p,flush=True)" % (str(HELPER),directory)
            process=subprocess.Popen([sys.executable,'-I','-S','-c',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            child=None
            try:
                output,error=process.communicate(timeout=1)
                child=int(output.strip())
                self.assertEqual(process.returncode,0,error)
                self.assertTrue((Path(directory)/'watchdog.log').exists())
            finally:
                if child:
                    try:os.kill(child,native.signal.SIGKILL)
                    except ProcessLookupError:pass
                if process.poll() is None:process.kill();process.wait(timeout=2)

    def test_each_denial_subprobe_has_its_own_budget_and_no_sudo_or_lookup(self):
        self.assertNotIn('check_output',native.PROBE)
        self.assertIn("part == 'authority'",native.PROBE)
        # Network arms do not execute subprocesses or use host DNS.
        self.assertIn("s.settimeout(3)",native.PROBE)
        self.assertIn("timeout=12",HELPER.read_text())
        workflow=(HELPER.parent.parent/'workflows/native-compile.yml').read_text()
        self.assertIn("inputs.mode == 'native' && 65 || 10",workflow)

    def test_watchdog_setup_failure_is_fenced_and_never_admitted(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            with patch.object(native.os,'fork',return_value=0),patch.object(native.os,'setsid',side_effect=OSError),patch.object(native.os,'_exit',side_effect=SystemExit),self.assertRaises(SystemExit):
                native.start_watchdog(root)
            self.assertTrue((root/'cleanup-started').exists())
            evidence=json.loads((root/'watchdog-evidence.json').read_text())
            self.assertTrue(evidence['startupFailed'])
            self.assertIsNone(evidence['policyRestored'])

    def test_watchdog_ready_timeout_aborts_and_reaps_only_spawned_child(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            with patch.object(native.os,'fork',return_value=999001),patch.object(native.select,'select',return_value=([],[],[])),patch.object(native.os,'kill') as kill,patch.object(native.os,'waitpid',return_value=(999001,0)),self.assertRaises(RuntimeError):
                native.start_watchdog(root)
            kill.assert_called_once_with(999001,native.signal.SIGKILL)
            self.assertTrue((root/'cleanup-started').exists())

    def test_dead_after_ready_is_not_admitted_or_killed_after_reap(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            with patch.object(native.os,'fork',return_value=999001),patch.object(native.select,'select',return_value=([123],[],[])),patch.object(native.os,'read',return_value=b'1'),patch.object(native.os,'waitpid',return_value=(999001,0)),patch.object(native.os,'kill') as kill,self.assertRaises(RuntimeError):
                native.start_watchdog(root)
            kill.assert_not_called()

    def test_ready_live_watchdog_is_admitted(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            with patch.object(native.os,'fork',return_value=999001),patch.object(native.select,'select',return_value=([123],[],[])),patch.object(native.os,'read',return_value=b'1'),patch.object(native.os,'waitpid',return_value=(0,0)):
                self.assertEqual(native.start_watchdog(root),999001)
            self.assertFalse((root/'cleanup-started').exists())

    def test_watchdog_death_closes_command_admission_before_spawn(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);context=self.command_fixture(root)
            state=json.loads((root/'state.json').read_text());state['watchdog_pid']=999001
            (root/'state.json').write_text(json.dumps(state))
            with patch.object(native,'COMMAND_CONTEXT',context),patch.object(native.os,'waitpid',return_value=(999001,0)),patch.object(native.subprocess,'Popen') as launch,self.assertRaises(RuntimeError):
                native.start_owned_command(['/bin/true'],{})
            launch.assert_not_called()
            self.assertTrue((root/'watchdog-reaped').exists())

    def test_failed_cleanup_watchdog_evidence_is_readable_and_never_claims_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            report=root/'export';report.mkdir()
            state=json.loads((root/'state.json').read_text());state['report']=str(report)
            (root/'state.json').write_text(json.dumps(state))
            log=root/'watchdog.log';log.write_text('native-compile phase=cleanup-started\nraw fixture must not be exposed\n')
            log.chmod(0o600)
            native.publish_watchdog_evidence(root)
            target=report/'watchdog-evidence.json';evidence=json.loads(target.read_text())
            self.assertEqual(evidence['watchdogPhases'],['cleanup-started'])
            self.assertFalse(evidence['cleanupComplete']);self.assertIsNone(evidence['policyRestored'])
            self.assertEqual(target.stat().st_mode & 0o777,0o444)
            self.assertEqual(log.stat().st_mode & 0o777,0o600)
            self.assertFalse((report/'watchdog.log').exists())
            self.assertTrue(all(p.stat().st_mode & 0o004 for p in report.iterdir()))

    def test_real_watchdog_ready_handshake_preserves_pipe_and_detached_io(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            state=json.loads((root/'state.json').read_text());state.update(watchdog_deadline=10**20,watchdog_requested=False)
            (root/'state.json').write_text(json.dumps(state))
            child=native.start_watchdog(root)
            try:
                self.assertTrue((root/'watchdog.log').exists())
                self.assertEqual(os.waitpid(child,os.WNOHANG),(0,0))
                self.assertFalse((root/'cleanup-started').exists())
            finally:
                os.kill(child,native.signal.SIGKILL)
                os.waitpid(child,0)

    def command_fixture(self,root):
        (root/'cleanup.lock').touch()
        (root/'state.json').write_text(json.dumps({'watchdog_deadline':10**20,'watchdog_requested':False}))
        return {'work':root,'helper':root/'trusted.py'}

    def test_launch_register_release_are_serialized_before_command_exec(self):
        events=[]
        process=Mock(pid=123)
        def launch(*args,**kwargs):events.append('launcher');return process
        def register(operation,pid):events.append('registered')
        with tempfile.TemporaryDirectory() as directory:
            context=self.command_fixture(Path(directory))
            with patch.object(native,'COMMAND_CONTEXT',context),patch.object(native,'GROUP_REGISTRAR',register),patch.object(native.subprocess,'Popen',side_effect=launch),patch.object(native.os,'write',side_effect=lambda *a:events.append('released')):
                self.assertIs(native.start_owned_command(['/bin/true'],{'start_new_session':True}),process)
        self.assertEqual(events,['launcher','registered','released'])

    def test_registration_failure_never_releases_exec_gate(self):
        process=Mock(pid=123)
        with tempfile.TemporaryDirectory() as directory:
            context=self.command_fixture(Path(directory))
            with patch.object(native,'COMMAND_CONTEXT',context),patch.object(native,'GROUP_REGISTRAR',side_effect=OSError),patch.object(native.subprocess,'Popen',return_value=process),patch.object(native.os,'write') as release,patch.object(native.os,'killpg') as kill,self.assertRaises(OSError):
                native.start_owned_command(['/bin/true'],{'start_new_session':True})
            release.assert_not_called()
            kill.assert_called_once_with(123,native.signal.SIGKILL)

    def test_cleanup_claim_blocks_new_command_before_spawn(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);context=self.command_fixture(root);(root/'cleanup-started').touch()
            with patch.object(native,'COMMAND_CONTEXT',context),patch.object(native.subprocess,'Popen') as launch,self.assertRaises(RuntimeError):
                native.start_owned_command(['/bin/true'],{})
            launch.assert_not_called()

    def test_parent_loss_gate_eof_never_executes_command(self):
        with patch.object(sys,'argv',['helper','spawn','7','/bin/true']),patch.object(native.os,'geteuid',return_value=0),patch.object(native.os,'read',return_value=b''),patch.object(native.os,'close'),patch.object(native.os,'execv') as execute,self.assertRaises(SystemExit) as error:
            native.main()
        self.assertEqual(error.exception.code,111)
        execute.assert_not_called()

    def test_stale_watchdog_decision_respects_refreshed_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.cleanup_state(root)
            state=json.loads((root/'state.json').read_text());state['watchdog_deadline']=10**20;state['watchdog_requested']=False
            (root/'state.json').write_text(json.dumps(state))
            with patch.object(native.os,'kill'),patch.object(native,'run') as command:
                self.assertFalse(native.cleanup(root,watchdog_parent=100))
            command.assert_not_called()
            self.assertFalse((root/'cleanup-started').exists())

    def test_native_promotion_refuses_expired_or_claimed_bootstrap(self):
        for claimed in [False,True]:
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.command_fixture(root)
                state=json.loads((root/'state.json').read_text())
                if claimed:(root/'cleanup-started').touch()
                else:state['watchdog_deadline']=0
                (root/'state.json').write_text(json.dumps(state))
                save=Mock()
                with self.assertRaises(RuntimeError):native.arm_native(root,save,True)
                save.assert_not_called()


if __name__=='__main__':unittest.main()

# Unified folder sync configs and shared file content

Selecting Downloads previously saved native folder access separately from its
cloud sync configuration. The editor now groups configs under the current
source folder and prepares the first backup config when adding a folder.
Additional configs retain independent direction, destination, exclusions,
pause state and measured activity.

Save & sync persists an exact-revision setup intent before enrollment. The
root scheduler can recover it after leaving the editor or reloading, without
replaying the settings write or prompting for native consent. A durable Pause
fence covers the interval before the first job exists. Remote enrollment uses
the negotiated 1.5.0 control contract and remains cancellable while consent is
pending.

Attachment content is shared only within its owning account. A protected blob
owns a verified physical generation and payload charge; logical attachment
references retain access checks, filenames and version history. Concurrent
admission and final-reference deletion share transactional accounting. Explicit
activation and historical-consolidation migrations keep rollout separate from
source delivery.

## Validation

- Isolated desktop and 375 px editor acceptance covers first config, multiple
  configs, leaving the editor before enrollment, reload, activity, and nested
  Builder edits. Remote desktop/mobile and destination scenarios passed.
- Focused configuration, enrollment, journal and editable-block checks passed
  (59 cases), plus desktop recovery. Remote protocol/client (16) and worker
  (13) checks passed, including Pause during pending enrollment.
- Storage checks include 355 attachment tests, 71 focused storage/batch/cloud
  tests, and 22 real transactional Mongo/private-byte retention checks. Real
  request-handler tests cover normal upload approval, parts, completion,
  content reads, deletion, two Files publications, cross-account refusal,
  quota/reference accounting and historical consolidation.
- Capability coverage passed 161 tests after the main-branch integration.
- Final file-sync coverage passed 845 cases with zero skips; raw TypeScript
  and Nitro server build passed. Changed-file lint passed after fixing a
  test-only annotation (17 nonblocking warnings in the broad run); the worker
  regression passed again after that correction. Signed installed acceptance
  remains a release gate. Isolated byte-provider tests do not establish
  production S3 or physical iPhone acceptance.

## Rollout boundary

The shared-content gate starts disabled. Every writer/deleter sharing the
production data plane must be compatible or fenced before activation. A broad
production-host WAF test also blocked Vercel Cron and was rolled back to Log;
the deployment runbook records the exact finding. The narrower retired-host
fence must preserve the promoted deployment's real Cron target and all intended
stable origins. Historical consolidation additionally drains previously issued
signed URLs before removing duplicate generations and refunding bytes.

The existing installed app and saved folder grants remain intact until the
final signed bundle passes verification. Production activation, historical
consolidation, actual Downloads/background activity, and physical iPhone
acceptance must be reported independently of local checks.

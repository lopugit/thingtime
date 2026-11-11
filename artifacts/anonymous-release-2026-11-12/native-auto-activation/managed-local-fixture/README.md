# Managed-local automatic replacement fixture: source-only checkpoint

The four files in source-freeze.json are frozen. Forty-seven focused tests pass
(8 new fixture controls, 6 existing helper isolation checks and 33 native
activation checks); syntax and scoped diff checks pass. The account/HTTP tests
use a synthetic HTTP host and simulated browser cookie jar. They are not app,
Mongo, safeStorage or automatic-replacement acceptance.

No app, helper operation or web build was started for this checkpoint. The
retained development app/profile and historical 85ee web output were preserved.
Parent must supply the fresh combined canonical build and exact output hashes
before setting the explicit local build-ready guard and running this command
from the repository root:

```sh
THINGTIME_NATIVE_BUNDLE_QA=1 THINGTIME_NATIVE_LOCAL_BUILD_READY=1 node electron/scripts/verify-web-bundle-auto-activation.mjs \
  --local-api \
  --workspace=native-bundle-qa-auto-local-pr1000 \
  --output=artifacts/anonymous-release-2026-11-12/native-auto-activation/managed-local-account \
  '--password-helper-app=/Users/lopu/Applications/Thingtime Dev native-auto-pr1000 Helpers/Thingtime Passwords.app' \
  '--password-fixture-app=/Users/lopu/Applications/Thingtime Dev native-auto-pr1000 Helpers/Thingtime Password Fixture.app' \
  --password-helper-host=com.thingtime.passwords.dev.nativeautopr1000 \
  --password-helper-team=6DQQ9V7C84 \
  '--password-helper-signing-identity=Apple Development: lopudesigns@gmail.com (9BTZ4XB356)'
```

The future run must observe the normal browser login exchange at the real local
appOrigin; no cookie injection, fixture AES profile or second login after restart.
It derives the account editor partition from canonical root-data and checks
identity before/after integrity-checked persistence readback. A real authenticated
POST /things remains incomplete for 45 seconds while the native HTTP gate, pending
release and original PID are checked, then commits and is read back. This proves
that HTTP lifetime class, not every possible runtime workload.

Only an actual automatic fresh native PID and managed Mongo PID, same origin,
recovered browser and independent API sessions, exact private Thing/revision/edit,
ACL and stale-revision refusals, durable editor reload, signed active release and
cleared pending trial can produce the local-account success receipt. The copied
native sources and helper executable are byte-compared and recorded. The native
helper group is verified empty before and after; its signed fixture only reads
emptiness. ProviderSession remains HTTPS-only: local HTTP account persistence
is distinct from native AutoFill/provider or password-vault restoration.

Success stops and cleans only this new QA workspace/database/resources; failure
stops the owned processes but preserves its diagnostic profile. Ports must be
released and the helper group remain empty for cleanup to pass. Stable app,
real accounts, prior retained dev build and installed helper identities stay intact.

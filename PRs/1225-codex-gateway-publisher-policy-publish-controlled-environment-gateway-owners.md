# PR1225 — Controlled environment gateway publication

The protected prebuilt publisher now maps production to thingtime.com, custom
develop to dev.thingtime.com and standard preview to master.previews.thingtime.com.
The preview master is separately built from trusted main with preview settings.
Existing Mongo/auth scopes remain unchanged; each gateway environment requires
its own encrypted bootstrap secret. Canonical owners are forced proxy while
ordinary branches retain their explicit dedicated-backend opt-in.

Reviewed corrections cover pre-upload alias snapshots, production skip-domain,
custom-target rollback after automatic assignment, removal of the competing
stable-develop alias writer, required canonical-host verification and the URL
scope used by final publication receipts. Full mocked READY-reuse acceptance
reproduced the URL failure before correction and now verifies status, summary
and mutation-free retry. Focused tests19/19 and PR self-tests147/147 pass.

The build-only boolean produces secretless target-specific CI artifacts with
publication disabled. Activation order is reviewed controller integration,
inventory/completion of older publishers, develop source integration, complete
deployment-scoped owner bootstrap, complete scoped startup settings and normal
publisher reconciliation. The product default-proxy policy remains gated on
owner readiness. No external settings, aliases, Atlas tier or credentials changed
while implementing this controller follow-up. Old deployments may age out.

Graphify code-only output and portable HTML are refreshed. The local proxy health
request timed out before semantic extraction; changed/new documentation was not
semantically re-indexed. Existing semantic nodes are retained, not fresh evidence.
The controller ignores copied local remix bootstrap scratch instead of indexing
uncommitted app setup as controller source.

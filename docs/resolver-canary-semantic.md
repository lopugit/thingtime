# Resolver canary: semantic extraction probe

This short note exists only to give the conflict resolver's refresh step a
semantic cache miss, so the claude-cli backend performs one real extraction
call in CI. The resolve-pr-conflicts workflow resets graphify-out to the base
side on dual-sided conflicts, then re-runs graphify with LLM semantic
extraction when a Claude credential exists. Safe to delete with its branch.

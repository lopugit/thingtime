# Codex GitHub CLI Setup Notes

The Codex GitHub setup script expects two prerequisites before it can authenticate:

1. The `gh` CLI must already be installed and available on `PATH`.
2. `GH_TOKEN` must be present in the environment.

If either prerequisite is missing, the script exits before `gh auth login`, `gh auth setup-git`, or `gh auth status` can complete.

In this container, `gh` is currently not available on `PATH`, and no `GH_TOKEN` variable is visible to the shell. That means the setup script cannot complete until the runtime image includes `gh` and the token is injected into the environment.

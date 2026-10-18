# Workflow verification

- Verify reusable workflows parse on GitHub before running a credential probe. Job-level environment expressions must not reference step outputs or runtime environment values; those belong in step inputs or step environments.

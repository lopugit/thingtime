# Workflow verification

- OpenAI preflight failures report the HTTP status and an allowlisted error code. Unknown codes and response messages must never enter logs; verify both quota classification and redaction before a bounded live vault probe.

- Verify reusable workflows parse on GitHub before running a credential probe. Job-level environment expressions must not reference step outputs or runtime environment values; those belong in step inputs or step environments.

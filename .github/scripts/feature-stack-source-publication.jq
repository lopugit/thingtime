# Admission captured and authenticated $sha. The history verifier requires
# that exact commit as a merge parent; newer live commits belong to a later run.
(.state == "open" or (.state == "closed" and .merged == true))
and .draft == false
and .head.repo.full_name == $repo
and .base.repo.full_name == $repo
and .head.ref == $head
and .base.ref == $base
and ($sha | test("^[0-9a-f]{40}$"))
and ([.labels[].name] | index("no-ai-merge") == null)
and ([.labels[].name] | index("ai-merge-paused") == null)

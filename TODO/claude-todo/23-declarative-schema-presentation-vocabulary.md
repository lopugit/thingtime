# 23 — Custom schema presentation: extend the declarative vocabulary

Owner request (2026-07-18, from the PR #73 schema-converter consolidation
discussion):

> If a schema ever needs custom presentation, the right lever is extending the
> declarative vocabulary — add a new data property (like `unit`, `values`, or
> the `render` tree today) and teach the one generic interpreter to understand
> it. Data describes; versioned code interprets. That keeps the
> everything-is-a-thing philosophy for what schemas *are*, without making the
> database a code-delivery channel.

This is a standing design principle, not a scheduled feature: apply it whenever
schema presentation/behaviour work comes up.

## What exists today (the pattern in action)

- **Per-schema knowledge is data on the schema's own document** (its crystal):
  name, description, fields, and each field's constraint metadata — `type`,
  `min`/`max`, `unit`, `values` (enum options), `maxLength`, plus the optional
  serialised `render` component tree for custom card previews.
- **One generic interpreter in versioned code** reads that data for every
  schema, builtin or community:
  `remix/app/components/Schemas/schemaBrowseTypes.ts`
  (`entryToCardSource` / `registryToCardSource` → `SchemaCardSource`,
  `toSearchSource` → /search's `SchemaSource`, seeded-builtin mirror dedup via
  `isSeededBuiltinMirror`). Consolidated in PR #73 after /schemas and /search
  each grew their own drifting copy.
- **`render` shows how presentation stays data**: it is a serialised component
  *tree* (declarative description), drawn only through the sanitising allowlist
  renderers — never executable code.

## The anti-pattern this guards against

Storing a serialised/hydratable **function** on the schema document and
executing it client-side. Why that's rejected:

1. **Stored XSS**: community schemas are user-written documents; hydrating
   functions from them means any schema author runs JS in every viewer's
   browser.
2. **Drift, multiplied**: PR #73 collapsed 2 copies of the converter into 1;
   per-document functions would mean N copies that a bug fix can never fully
   reach (old documents keep old code forever without a migration).
3. **Invisible to tooling**: code in Mongo escapes TypeScript, tests, review,
   and git history.

## How to apply (when a schema needs presentation the vocabulary can't say)

1. Design the need as a **data property** on the schema crystal (a flag, an
   enum, a nested descriptor object — like `unit` / `values` / `render`).
2. Teach the **one generic interpreter** (`schemaBrowseTypes.ts` and, where
   relevant, the sanitising renderers / search flattener) to understand the new
   property for every schema at once.
3. Keep validation server-side with the schema registry as the source of truth,
   and keep any renderer behind the sanitising allowlist path.
4. Never accept executable code (functions, expressions to eval, component
   factories) through a document field.

## Done when

Evergreen — this file is the reference. A concrete feature applying it should
link back here and demonstrate: new property documented on the crystal, one
interpreter change covering builtin + community schemas identically, and no
code-shaped values accepted from documents.

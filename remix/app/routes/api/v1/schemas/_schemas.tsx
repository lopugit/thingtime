import { json } from '~/api/http';

import { getThingtimeSchema, thingtimeSchemas, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

// GET /api/v1/schemas — every Thingtime Schema (root thing schema, crystal
// sub-schemas, collection schemas), straight from the registry the API
// validates against. Public: schemas describe shapes, never data.
// GET /api/v1/schemas?id=post — one schema.
export const loader = async ({ request }: { request: Request }) => {
  const params = new URL(request.url).searchParams;
  const id = (params.get('id') || '').trim();

  if (id) {
    const schema = getThingtimeSchema(id);
    if (!schema) {
      return json({ ok: false, error: 'Unknown schema' }, { status: 404 });
    }
    return json({ ok: true, schema });
  }

  return json({
    ok: true,
    schemas: thingtimeSchemas,
    collectionVersions: COLLECTION_SCHEMA_VERSIONS
  });
};

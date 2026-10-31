import { SchemaDetailPage } from '~/components/Schemas/SchemaDetailPage';

// /schemas/:key — one schema on its own page: the field tree and render
// preview, plus the LIVE create-a-thing form and the viewer's things of that
// shape. :key is a registry id (builtin:<id> or the bare id) or a schema
// thing's shareId.
export default function SchemaDetail() {
	return <SchemaDetailPage />;
}

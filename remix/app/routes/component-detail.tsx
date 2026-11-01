import { ComponentDetailPage } from '~/components/ComponentsLibrary/ComponentDetailPage';

// /components/:key — a component family's own deep-linked page; the /docs
// twin lands scrolled to the documentation section.
export default function ComponentDetail() {
	return <ComponentDetailPage />;
}

export function ComponentDetailDocs() {
	return <ComponentDetailPage docsFocus />;
}

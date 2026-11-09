import { ActionsPage } from '~/components/Actions/ActionsPage';

export default function Actions() {
	return <ActionsPage />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "title": "Thingtime actions",
  "description": "Small, clear actions that turn your things into useful little workflows.",
  "eyebrow": "THINGTIME · ACTIONS",
  "badges": [
    "Do more",
    "Keep context"
  ],
  "variant": "collection"
} as const;

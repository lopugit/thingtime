import { DesignWorkspace } from './DesignWorkspace';

export default function DocsDesign() {
  return <DesignWorkspace testIdPrefix="design" />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "pageTitle": "Thingtime docs - Design mockups"
} as const;

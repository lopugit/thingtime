// Both routes use the same live runtime, page surface and editing SDK.
export { default } from '../components/Builder/LiveWebpage';


// Optional public fallback copy; actual content still requires anonymous access.
export const socialPreview = { title: 'A page on Thingtime', pageTitle: 'Page' } as const;

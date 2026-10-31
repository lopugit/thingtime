export const attachmentContentPath = (attachmentId: string): string => {
	const params = new URLSearchParams({ id: attachmentId });
	return `/api/v1/attachments/content?${params.toString()}`;
};

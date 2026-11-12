type AttachmentDraftCleanup = () => Promise<void>;

const cleanups = new Set<AttachmentDraftCleanup>();

// Account/session transitions must give mounted composers a chance to clean
// their private drafts while the OLD httpOnly session is still active. Keeping
// this registry UI-only avoids passing credentials or owner ids through the
// browser; the authenticated attachment endpoints remain the authority.
export const registerAttachmentDraftCleanup = (cleanup: AttachmentDraftCleanup) => {
	cleanups.add(cleanup);
	return () => {
		cleanups.delete(cleanup);
	};
};

export const flushAttachmentDraftCleanups = async (): Promise<void> => {
	await Promise.allSettled([...cleanups].map((cleanup) => cleanup()));
};

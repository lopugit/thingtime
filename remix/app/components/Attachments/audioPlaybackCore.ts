// Ordered attachment IDs form the queue contract. Keeping the next-track rule
// pure means the player can be verified without a media device or a browser.
export const nextQueuedAudioIndex = (currentIndex: number, queueLength: number): number | null =>
	currentIndex + 1 < queueLength ? currentIndex + 1 : null;

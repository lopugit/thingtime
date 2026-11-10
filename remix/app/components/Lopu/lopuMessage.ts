export type LopuMessageInput = {
  title?: unknown;
  description?: unknown;
  status?: 'success' | 'error' | 'info' | 'warning';
};

const cleanText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

// Runtime callers are not always type-safe (API payloads used to pass
// `error:true`). Guarantee that a one-shot Lopu toast can never render only a
// status glyph with no explanation.
export const normalizeLopuMessage = ({ title, description, status }: LopuMessageInput) => {
  const safeDescription = cleanText(description);
  const safeTitle = cleanText(title);
  if (safeTitle || safeDescription) return { title: safeTitle, description: safeDescription };
  if (status === 'error') return { title: 'Something went wrong. Please try again.', description: undefined };
  if (status === 'success') return { title: 'Done ✨', description: undefined };
  return { title: 'Here when you need me 🦄', description: undefined };
};

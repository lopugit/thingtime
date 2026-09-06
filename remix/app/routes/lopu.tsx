import { LopuPage } from '~/components/Lopu/LopuPage';

// /lopu and /lopu/:chatId — the full-page Lopu 🦄 assistant: conversations
// column + the shared chat view (the floating window continues the same
// conversation through the module store).
export default function Lopu() {
	return <LopuPage />;
}

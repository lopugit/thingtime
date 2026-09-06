import React from 'react';
import { AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, Box, Button, Checkbox, Text } from '@chakra-ui/react';

import type { TtActionConfirmHandler } from './useTtActionClicks';

// The catalog-side confirmation (claude-todo/20-tester-runs-actions.md): on
// a surface the viewer did not compose — a component's own page, a demo, a
// stranger's thing rendered live — the first press of each control names
// exactly what will run before anything executes. The dialog is the source
// of truth, never the button label (author-controlled markup can say
// "Preview" and bind anything).
//
// Wording is deliberately honest about what the client can know: a
// delegated run resolves OWNER-ONLY on the server, so the program that runs
// is always one of the viewer's own — the dialog says so, shows the action
// reference and the inputs as JSON, and offers a per-action skip that lasts
// only for this page session (never persisted, never global). Surfaces that
// render the viewer's OWN authored thing may pass `skipForOwn` to bypass it.

const MAX_INPUT_PREVIEW_CHARS = 600;

const describeInputs = (inputs: Record<string, unknown>): string => {
	try {
		const text = JSON.stringify(inputs, null, 1);
		return text.length > MAX_INPUT_PREVIEW_CHARS ? `${text.slice(0, MAX_INPUT_PREVIEW_CHARS)}…` : text;
	} catch {
		return '{}';
	}
};

type Pending = { action: string; inputs: Record<string, unknown>; resolve: (approved: boolean) => void };

export const useActionRunConfirm = (options?: { enabled?: boolean; resolveActionName?: (action: string) => string | null }): { confirm: TtActionConfirmHandler; dialog: React.ReactNode } => {
	const enabled = options?.enabled !== false;
	const [pending, setPending] = React.useState<Pending | null>(null);
	const [skipThis, setSkipThis] = React.useState(false);
	// per-action, per-page-session skips — a plain Set in a ref, so a reload
	// (or a different page) asks again
	const skippedRef = React.useRef<Set<string>>(new Set());
	const cancelRef = React.useRef<HTMLButtonElement | null>(null);
	const resolveNameRef = React.useRef(options?.resolveActionName);
	resolveNameRef.current = options?.resolveActionName;

	const confirm = React.useCallback<TtActionConfirmHandler>(
		(request) => {
			if (!enabled) return true;
			// pseudo-actions run nothing on the server
			if (request.action.startsWith('$')) return true;
			if (skippedRef.current.has(request.action)) return true;
			return new Promise<boolean>((resolve) => {
				setSkipThis(false);
				setPending({ action: request.action, inputs: request.inputs, resolve });
			});
		},
		[enabled]
	);

	const settle = (approved: boolean) => {
		const current = pending;
		setPending(null);
		if (!current) return;
		if (approved && skipThis) skippedRef.current.add(current.action);
		current.resolve(approved);
	};

	const name = pending ? resolveNameRef.current?.(pending.action) || null : null;
	const dialog = (
		<AlertDialog isOpen={!!pending} leastDestructiveRef={cancelRef} onClose={() => settle(false)} isCentered>
			<AlertDialogOverlay>
				<AlertDialogContent borderRadius="var(--tt-radius-lg, 16px)" data-testid="action-run-confirm">
					<AlertDialogHeader fontSize="md" fontWeight={800}>
						Run {name ? `“${name}”` : 'this program'}?
					</AlertDialogHeader>
					<AlertDialogBody fontSize="sm" color="var(--tt-text, #5a5a66)">
						<Text>
							This control runs <strong>your own</strong> action{' '}
							<Box as="code" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="12px" background="var(--tt-surface, #fafafb)" padding="1px 6px" borderRadius="6px">
								{pending?.action}
							</Box>{' '}
							as you — it can only touch your own things, and the run lands in your action history. The button label is decoration; this is what executes.
						</Text>
						<Box as="pre" marginTop={3} fontSize="11px" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" whiteSpace="pre-wrap" background="var(--tt-surface, #fafafb)" padding={2} borderRadius="8px" maxHeight="160px" overflow="auto">
							{pending ? describeInputs(pending.inputs) : ''}
						</Box>
						<Checkbox size="sm" marginTop={3} isChecked={skipThis} onChange={(event) => setSkipThis(event.target.checked)}>
							Don’t ask again for this action on this page
						</Checkbox>
					</AlertDialogBody>
					<AlertDialogFooter columnGap={2}>
						<Button ref={cancelRef} size="sm" variant="ghost" onClick={() => settle(false)} data-testid="action-run-cancel">
							Cancel
						</Button>
						<Button size="sm" onClick={() => settle(true)} data-testid="action-run-approve">
							Run ⚡
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialogOverlay>
		</AlertDialog>
	);
	return { confirm, dialog };
};

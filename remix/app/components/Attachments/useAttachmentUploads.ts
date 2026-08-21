import React from 'react';

import { useApi } from '~/hooks/useApi';
import {
	attachmentCleanupAction,
	attachmentCompleteRetryPhase,
	attachmentSnapshot,
	attachmentUploadError,
	attachmentUploadFailurePhase,
	dedupeSelectedFiles,
	localFileMediaKind,
	MAX_POST_ATTACHMENTS,
	multipartPartRange,
	normalizePublicAttachment
} from './attachmentUiCore';
import type { AttachmentUploadOptions, ComposerAttachmentUpload, SignedUploadPart } from './attachmentTypes';
import { registerAttachmentDraftCleanup } from './attachmentDraftCleanup';

const MAX_CONCURRENT_FILES = 3;
const PART_SIGNATURE_BATCH = 3;

const localUploadId = () =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const sha256Base64 = async (blob: Blob): Promise<string> => {
	const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
};

const putSignedPart = (
	part: SignedUploadPart,
	body: Blob,
	onProgress: (loaded: number) => void,
	onXhr: (xhr: XMLHttpRequest | null) => void
): Promise<void> =>
	new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		onXhr(xhr);
		xhr.open('PUT', part.url);
		Object.entries(part.headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));
		xhr.upload.onprogress = (event) => onProgress(event.lengthComputable ? event.loaded : 0);
		xhr.onerror = () => {
			onXhr(null);
			reject(new Error('upload failed'));
		};
		xhr.onabort = () => {
			onXhr(null);
			reject(new DOMException('Upload cancelled', 'AbortError'));
		};
		xhr.onload = () => {
			onProgress(body.size);
			onXhr(null);
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else reject(new Error(`upload status ${xhr.status}`));
		};
		// Clear this exact XHR before resolving. Waiting for `loadend` can race
		// the async loop: the next part may install its XHR first, then the prior
		// part's loadend would erase that newer cancellation handle.
		// Keep the Blob's type empty and set only the exact signed checksum header.
		// Adding Content-Type here would invalidate signatures that did not sign it.
		xhr.send(body);
	});

type QueueEntry = {
	localId: string;
	file: File;
	attempt: number;
	completeOnly?: boolean;
	resumeExisting?: boolean;
};

type UploadPlan = { uploadId: string; partSizeBytes: number; partCount: number };

export const useAttachmentUploads = (
	ownerId: string | null | undefined,
	onCleanupError?: (message: string) => void,
	onSelectionError?: (message: string) => void,
	preserveReadyOnUnmount = false,
	onCleanupDeferred?: () => void,
	options: AttachmentUploadOptions = {}
) => {
	const uploadPurpose = options.purpose ?? 'post';
	const maxFiles = Number.isSafeInteger(options.maxFiles)
		? Math.max(1, Math.min(MAX_POST_ATTACHMENTS, Number(options.maxFiles)))
		: MAX_POST_ATTACHMENTS;
	const imageOnly = options.imageOnly === true;
	const maxBytesPerFile =
		Number.isSafeInteger(options.maxBytesPerFile) && Number(options.maxBytesPerFile) > 0 ? Number(options.maxBytesPerFile) : null;
	const allowedContentTypes = React.useMemo(
		() => (options.allowedContentTypes?.length ? new Set(options.allowedContentTypes.map((value) => value.toLowerCase())) : null),
		[options.allowedContentTypes]
	);
	const uploadErrorContextRef = React.useRef({
		remainingBytes: options.remainingBytes,
		storageStatus: options.storageStatus
	});
	uploadErrorContextRef.current = {
		remainingBytes: options.remainingBytes,
		storageStatus: options.storageStatus
	};
	const api = useApi();
	const apiRef = React.useRef(api.v1.attachments);
	apiRef.current = api.v1.attachments;

	const [uploads, setUploads] = React.useState<ComposerAttachmentUpload[]>([]);
	const uploadsRef = React.useRef(uploads);
	uploadsRef.current = uploads;
	const mountedRef = React.useRef(true);
	const ownerRef = React.useRef(ownerId ?? null);
	const attemptsRef = React.useRef(new Map<string, number>());
	const activeXhrsRef = React.useRef(new Map<string, XMLHttpRequest>());
	const activeRequestsRef = React.useRef(new Map<string, AbortController>());
	const committedAttachmentIdsRef = React.useRef(new Set<string>());
	const uploadPlansRef = React.useRef(new Map<string, UploadPlan>());
	const preserveReadyOnUnmountRef = React.useRef(preserveReadyOnUnmount);
	preserveReadyOnUnmountRef.current = preserveReadyOnUnmount;
	const queueRef = React.useRef<QueueEntry[]>([]);
	const runningRef = React.useRef(0);
	const pumpRef = React.useRef<() => void>(() => {});

	const cleanupUpload = React.useCallback((upload: ComposerAttachmentUpload) => {
		const action = attachmentCleanupAction(upload, committedAttachmentIdsRef.current);
		if (action?.kind === 'delete') return apiRef.current.remove({ id: action.attachmentId });
		if (action?.kind === 'abort') return apiRef.current.uploads.abort({ uploadId: action.uploadId });
		return null;
	}, []);

	const isCurrent = React.useCallback((localId: string, attempt: number) => mountedRef.current && attemptsRef.current.get(localId) === attempt, []);

	const patchUpload = React.useCallback(
		(localId: string, attempt: number, patch: Partial<ComposerAttachmentUpload>) => {
			if (!isCurrent(localId, attempt)) return;
			setUploads((current) => current.map((upload) => (upload.localId === localId ? { ...upload, ...patch } : upload)));
		},
		[isCurrent]
	);

	const completeUpload = React.useCallback(
		async (localId: string, uploadId: string, attempt: number, signal?: AbortSignal) => {
			patchUpload(localId, attempt, { status: 'finalizing', progress: 100, error: null, failedAt: null });
			try {
				const response = await apiRef.current.uploads.complete({ uploadId }, { signal });
				if (!isCurrent(localId, attempt)) return;
				const attachment = normalizePublicAttachment(response?.attachment);
				if (!attachment) throw new Error('invalid attachment projection');
				patchUpload(localId, attempt, { status: 'ready', attachment, progress: 100, uploadId, error: null, failedAt: null });
			} catch (error) {
				if (!isCurrent(localId, attempt)) return;
				// Only the server paths that explicitly CAS finalizing -> pending may
				// safely re-upload parts. Other 409s deliberately leave finalization in
				// progress, so retry must poll/complete instead of calling /parts.
				patchUpload(localId, attempt, {
					status: 'error',
					error: attachmentUploadError(error, 'complete'),
					failedAt: attachmentCompleteRetryPhase(error)
				});
			}
		},
		[isCurrent, patchUpload]
	);

	const runUpload = React.useCallback(
		async ({ localId, file, attempt, completeOnly, resumeExisting }: QueueEntry) => {
			if (!isCurrent(localId, attempt)) return;
			const controller = new AbortController();
			activeRequestsRef.current.set(localId, controller);
			const existing = uploadsRef.current.find((upload) => upload.localId === localId);
			if (completeOnly && existing?.uploadId) {
				await completeUpload(localId, existing.uploadId, attempt, controller.signal);
				if (activeRequestsRef.current.get(localId) === controller) activeRequestsRef.current.delete(localId);
				return;
			}

			const savedPlan = uploadPlansRef.current.get(localId);
			const canResume = resumeExisting === true && !!existing?.uploadId && !!savedPlan && savedPlan.uploadId === existing.uploadId;
			patchUpload(localId, attempt, {
				status: canResume ? 'uploading' : 'preparing',
				progress: 0,
				error: null,
				failedAt: null,
				attachment: null
			});
			let uploadId: string | null = canResume ? savedPlan.uploadId : null;
			let partSizeBytes = canResume ? savedPlan.partSizeBytes : 0;
			let partCount = canResume ? savedPlan.partCount : 0;
			try {
				if (!canResume) {
					const response = await apiRef.current.uploads.create(
						{
							requestId: localId,
							filename: file.name,
							contentType: file.type || 'application/octet-stream',
							sizeBytes: file.size,
							...(uploadPurpose === 'post' ? {} : { purpose: uploadPurpose })
						},
						{ signal: controller.signal }
					);
					const prepared = response?.upload;
					uploadId = typeof prepared?.id === 'string' ? prepared.id : null;
					partSizeBytes = Number(prepared?.partSizeBytes);
					partCount = Number(prepared?.partCount);
					if (!uploadId || !Number.isSafeInteger(partSizeBytes) || partSizeBytes <= 0 || !Number.isSafeInteger(partCount) || partCount <= 0) {
						throw new Error('invalid upload plan');
					}
					uploadPlansRef.current.set(localId, { uploadId, partSizeBytes, partCount });
					if (!isCurrent(localId, attempt)) {
						void apiRef.current.uploads.abort({ uploadId }).catch(() => {});
						return;
					}
					patchUpload(localId, attempt, { uploadId, status: 'uploading' });
				}

				let committedBytes = 0;
				const progressState = { lastReported: -1 };
				for (let first = 1; first <= partCount; first += PART_SIGNATURE_BATCH) {
					const last = Math.min(partCount, first + PART_SIGNATURE_BATCH - 1);
					const requested: Array<{ partNumber: number; checksumSha256: string }> = [];
					const bodies = new Map<number, Blob>();
					for (let partNumber = first; partNumber <= last; partNumber += 1) {
						if (!isCurrent(localId, attempt)) return;
						const range = multipartPartRange(partNumber, partSizeBytes, file.size);
						const body = file.slice(range.start, range.end, '');
						bodies.set(partNumber, body);
						requested.push({ partNumber, checksumSha256: await sha256Base64(body) });
					}

					const signedResponse = await apiRef.current.uploads.parts({ uploadId, parts: requested }, { signal: controller.signal });
					const signedParts = Array.isArray(signedResponse?.parts) ? (signedResponse.parts as SignedUploadPart[]) : [];
					if (signedParts.length !== requested.length) throw new Error('invalid signed parts');
					const signedByNumber = new Map(signedParts.map((part) => [part.partNumber, part]));

					for (let partNumber = first; partNumber <= last; partNumber += 1) {
						if (!isCurrent(localId, attempt)) return;
						const body = bodies.get(partNumber);
						const signed = signedByNumber.get(partNumber);
						if (!body || !signed) throw new Error('missing signed part');
						const beforePart = committedBytes;
						await putSignedPart(
							signed,
							body,
							(loaded) => {
								const progress = file.size > 0 ? Math.min(99, Math.round(((beforePart + loaded) / file.size) * 100)) : 99;
								if (progress === progressState.lastReported) return;
								progressState.lastReported = progress;
								patchUpload(localId, attempt, { progress });
							},
							(xhr) => {
								if (xhr) activeXhrsRef.current.set(localId, xhr);
								else activeXhrsRef.current.delete(localId);
							}
						);
						committedBytes += body.size;
					}
				}

				await completeUpload(localId, uploadId, attempt, controller.signal);
			} catch (error) {
				if (!isCurrent(localId, attempt)) return;
				const phase = uploadId ? 'upload' : 'prepare';
				patchUpload(localId, attempt, {
					status: 'error',
					error: attachmentUploadError(error, phase, {
						...uploadErrorContextRef.current,
						fileSizeBytes: file.size
					}),
					failedAt: attachmentUploadFailurePhase(error, phase)
				});
			} finally {
				if (activeRequestsRef.current.get(localId) === controller) activeRequestsRef.current.delete(localId);
			}
		},
		[completeUpload, isCurrent, patchUpload, uploadPurpose]
	);

	pumpRef.current = () => {
		while (runningRef.current < MAX_CONCURRENT_FILES && queueRef.current.length) {
			const entry = queueRef.current.shift()!;
			if (!isCurrent(entry.localId, entry.attempt)) continue;
			runningRef.current += 1;
			void runUpload(entry).finally(() => {
				runningRef.current = Math.max(0, runningRef.current - 1);
				pumpRef.current();
			});
		}
	};

	const enqueue = React.useCallback((entry: QueueEntry) => {
		queueRef.current.push(entry);
		pumpRef.current();
	}, []);

	const addFilesInternal = React.useCallback(
		(files: File[], replaceExisting: boolean) => {
			const current = replaceExisting ? [] : uploadsRef.current;
			const eligible = files.filter(
				(file) =>
					(!imageOnly || localFileMediaKind(file) === 'image') &&
					(!allowedContentTypes || allowedContentTypes.has(file.type.toLowerCase())) &&
					(!maxBytesPerFile || file.size <= maxBytesPerFile)
			);
			if (eligible.length < files.length) {
				onSelectionError?.(
					maxBytesPerFile
						? `Choose a supported image no larger than ${Math.round(maxBytesPerFile / 1024)} KiB.`
						: 'Choose a JPEG, PNG, GIF, WebP, or AVIF image.'
				);
			}
			const unique = dedupeSelectedFiles(current, eligible);
			const availableSlots = Math.max(0, maxFiles - current.length);
			const accepted = unique.slice(0, availableSlots);
			if (accepted.length < unique.length) {
				onSelectionError?.(maxFiles === 1 ? 'Choose one image for this profile field.' : `Posts can include up to ${maxFiles} attachments.`);
			}
			if (!accepted.length) return;

			if (replaceExisting) {
				for (const upload of uploadsRef.current) {
					attemptsRef.current.set(upload.localId, (attemptsRef.current.get(upload.localId) || 0) + 1);
					queueRef.current = queueRef.current.filter((entry) => entry.localId !== upload.localId);
					activeRequestsRef.current.get(upload.localId)?.abort();
					activeRequestsRef.current.delete(upload.localId);
					activeXhrsRef.current.get(upload.localId)?.abort();
					activeXhrsRef.current.delete(upload.localId);
					if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
					uploadPlansRef.current.delete(upload.localId);
					const cleanup = preserveReadyOnUnmountRef.current && upload.attachment ? null : cleanupUpload(upload);
					void cleanup
						?.then((result: any) => {
							if (result?.deferred === true) onCleanupDeferred?.();
						})
						.catch((error: unknown) => onCleanupError?.(attachmentUploadError(error, 'cleanup')));
				}
				uploadsRef.current = [];
				setUploads([]);
			}
			const next = accepted.map((file) => {
				const localId = localUploadId();
				const previewUrl = localFileMediaKind(file) === 'file' ? null : URL.createObjectURL(file);
				attemptsRef.current.set(localId, 1);
				return {
					localId,
					file,
					previewUrl,
					status: 'queued' as const,
					progress: 0,
					uploadId: null,
					attachment: null,
					error: null,
					failedAt: null
				};
			});
			const nextUploads = [...current, ...next];
			uploadsRef.current = nextUploads;
			setUploads(nextUploads);
			for (const upload of next) enqueue({ localId: upload.localId, file: upload.file, attempt: 1 });
		},
		[allowedContentTypes, cleanupUpload, enqueue, imageOnly, maxBytesPerFile, maxFiles, onCleanupDeferred, onCleanupError, onSelectionError]
	);

	const addFiles = React.useCallback((files: File[]) => addFilesInternal(files, false), [addFilesInternal]);
	const replaceFiles = React.useCallback((files: File[]) => addFilesInternal(files, true), [addFilesInternal]);

	const retry = React.useCallback(
		async (localId: string) => {
			const upload = uploadsRef.current.find((entry) => entry.localId === localId);
			if (!upload || upload.status !== 'error' || upload.failedAt === 'terminal') return;
			const nextAttempt = (attemptsRef.current.get(localId) || 0) + 1;
			attemptsRef.current.set(localId, nextAttempt);
			activeRequestsRef.current.get(localId)?.abort();
			activeRequestsRef.current.delete(localId);
			activeXhrsRef.current.get(localId)?.abort();
			activeXhrsRef.current.delete(localId);
			const completeOnly = upload.failedAt === 'complete' && Boolean(upload.uploadId);
			const savedPlan = uploadPlansRef.current.get(localId);
			const resumeExisting = !completeOnly && !!upload.uploadId && !!savedPlan && savedPlan.uploadId === upload.uploadId;
			setUploads((current) =>
				current.map((entry) =>
					entry.localId === localId
						? {
								...entry,
								status: completeOnly ? 'queued' : 'preparing',
								progress: completeOnly ? 100 : 0,
								uploadId: entry.uploadId,
								error: null,
								failedAt: null
						  }
						: entry
				)
			);
			if (!completeOnly && !resumeExisting && upload.uploadId) {
				patchUpload(localId, nextAttempt, {
					status: 'error',
					error: 'This upload can no longer resume. Remove the file, then add it again.',
					failedAt: 'upload'
				});
				return;
			}
			enqueue({ localId, file: upload.file, attempt: nextAttempt, completeOnly, resumeExisting });
		},
		[enqueue, patchUpload]
	);

	const remove = React.useCallback(
		(localId: string) => {
			const upload = uploadsRef.current.find((entry) => entry.localId === localId);
			if (!upload) return;
			attemptsRef.current.set(localId, (attemptsRef.current.get(localId) || 0) + 1);
			queueRef.current = queueRef.current.filter((entry) => entry.localId !== localId);
			activeRequestsRef.current.get(localId)?.abort();
			activeRequestsRef.current.delete(localId);
			activeXhrsRef.current.get(localId)?.abort();
			activeXhrsRef.current.delete(localId);
			if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
			uploadPlansRef.current.delete(localId);
			setUploads((current) => current.filter((entry) => entry.localId !== localId));
			const cleanup = preserveReadyOnUnmountRef.current && upload.attachment ? null : cleanupUpload(upload);
			void cleanup
				?.then((result: any) => {
					if (result?.deferred === true) onCleanupDeferred?.();
				})
				.catch((error: unknown) => onCleanupError?.(attachmentUploadError(error, 'cleanup')));
		},
		[cleanupUpload, onCleanupDeferred, onCleanupError]
	);

	// Move one upload to another upload's position (the snapshot's attachmentIds
	// order follows this array, so this IS the order the server will store).
	const reorder = React.useCallback((sourceLocalId: string, targetLocalId: string) => {
		if (sourceLocalId === targetLocalId) return;
		const current = uploadsRef.current;
		const from = current.findIndex((upload) => upload.localId === sourceLocalId);
		const to = current.findIndex((upload) => upload.localId === targetLocalId);
		if (from < 0 || to < 0 || from === to) return;
		const next = [...current];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		uploadsRef.current = next;
		setUploads(next);
	}, []);

	const markCommitted = React.useCallback((attachmentIds: string[]) => {
		for (const id of attachmentIds) committedAttachmentIdsRef.current.add(id);
	}, []);

	const flushDraftsBeforeSessionChange = React.useCallback(async () => {
		const current = uploadsRef.current;
		if (!current.length) return;
		uploadsRef.current = [];
		queueRef.current = [];
		const operations: Array<Promise<unknown>> = [];
		for (const upload of current) {
			attemptsRef.current.set(upload.localId, (attemptsRef.current.get(upload.localId) || 0) + 1);
			activeRequestsRef.current.get(upload.localId)?.abort();
			activeXhrsRef.current.get(upload.localId)?.abort();
			if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
			const cleanup = preserveReadyOnUnmountRef.current && upload.attachment ? null : cleanupUpload(upload);
			if (cleanup) operations.push(cleanup);
		}
		activeRequestsRef.current.clear();
		activeXhrsRef.current.clear();
		uploadPlansRef.current.clear();
		setUploads([]);
		await Promise.allSettled(operations);
	}, [cleanupUpload]);

	React.useEffect(() => registerAttachmentDraftCleanup(flushDraftsBeforeSessionChange), [flushDraftsBeforeSessionChange]);

	React.useEffect(() => {
		const nextOwner = ownerId ?? null;
		if (ownerRef.current === nextOwner) return;
		ownerRef.current = nextOwner;
		for (const upload of uploadsRef.current) {
			attemptsRef.current.set(upload.localId, (attemptsRef.current.get(upload.localId) || 0) + 1);
			activeRequestsRef.current.get(upload.localId)?.abort();
			activeXhrsRef.current.get(upload.localId)?.abort();
			if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
			const cleanup = preserveReadyOnUnmountRef.current && upload.attachment ? null : cleanupUpload(upload);
			void cleanup?.catch(() => {});
		}
		queueRef.current = [];
		uploadPlansRef.current.clear();
		activeRequestsRef.current.clear();
		activeXhrsRef.current.clear();
		committedAttachmentIdsRef.current.clear();
		setUploads([]);
	}, [cleanupUpload, ownerId]);

	React.useEffect(() => {
		mountedRef.current = true;
		const activeRequests = activeRequestsRef.current;
		const activeXhrs = activeXhrsRef.current;
		const uploadPlans = uploadPlansRef.current;
		return () => {
			mountedRef.current = false;
			queueRef.current = [];
			// Teardown intentionally reads the latest upload snapshot, not the one
			// captured when this mount-only effect was installed.
			// eslint-disable-next-line react-hooks/exhaustive-deps
			for (const upload of uploadsRef.current) {
				activeRequests.get(upload.localId)?.abort();
				activeXhrs.get(upload.localId)?.abort();
				if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
				if (!preserveReadyOnUnmountRef.current || !upload.attachment) {
					void cleanupUpload(upload)?.catch(() => {});
				}
			}
			activeRequests.clear();
			activeXhrs.clear();
			uploadPlans.clear();
		};
	}, [cleanupUpload]);

	const snapshot = React.useMemo(() => attachmentSnapshot(uploads), [uploads]);

	return {
		uploads,
		addFiles,
		replaceFiles,
		retry,
		remove,
		reorder,
		markCommitted,
		snapshot
	};
};

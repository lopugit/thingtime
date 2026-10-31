// Server log fields only: never add request, object, owner, or error text.
const stages = new Set([
    'validate-request', 'load-upload', 'claim-lease', 'create-client', 'renew-lease',
    'reconcile-lease', 'persist-version', 'revert-lease', 'list-parts',
    'complete-multipart', 'verify-object', 'store-empty', 'detect-content',
    'persist-ready', 'tag-ready', 'queue-moderation'
] as const);
export type AttachmentFinalizationStage = typeof stages extends Set<infer T> ? T : never;
const names = new Set([
    'Error', 'TypeError', 'RangeError', 'Unknown', 'AbortError', 'TimeoutError',
    'MongoServerError', 'MongoNetworkError', 'MongoServerSelectionError',
    'CredentialsProviderError', 'PrivateS3ConfigError', 'StorageMutationError',
    'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NoSuchUpload',
    'NoSuchKey', 'NoSuchVersion', 'NotFound', 'RequestTimeout', 'SlowDown',
    'ServiceUnavailable', 'InternalError', 'NetworkingError', 'ECONNRESET',
    'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'MalformedXML', 'InvalidPart',
    'InvalidPartOrder', 'EntityTooSmall', 'InvalidRequest', 'InvalidArgument',
    'PreconditionFailed', 'ExpiredToken', 'InvalidToken', 'AuthorizationHeaderMalformed',
    'PermanentRedirect', 'RequestTimeTooSkewed', 'NotImplemented', 'BadDigest',
    'accounting_unavailable', 'storage_conflict'
]);
// Own data fields only: never invoke getters or coerce arbitrary error values.
// Proxy reflection and prototype checks can themselves throw and are guarded.
const ownValue = (value: unknown, key: string): unknown => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    } catch { return undefined; }
};
const allowedName = (value: unknown): string | undefined =>
    typeof value === 'string' && names.has(value) ? value : undefined;
const boundedInteger = (value: unknown, min: number, max: number): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
export const finalizationDiagnostic = (stage: AttachmentFinalizationStage, error: unknown) => {
    let thrownKind: string = error === null ? 'null' : typeof error;
    try {
        if (error instanceof Error) thrownKind = 'error';
        else if (Array.isArray(error)) thrownKind = 'array';
    } catch { thrownKind = 'unknown'; }
    const errorClass = allowedName(ownValue(error, 'name')) || (thrownKind === 'error' ? 'Error' : 'Unknown');
    const errorCode = allowedName(ownValue(error, 'code')) || allowedName(ownValue(error, 'Code'));
    const metadata = ownValue(error, '$metadata');
    const upstreamStatus = boundedInteger(ownValue(metadata, 'httpStatusCode'), 100, 599);
    const attempts = boundedInteger(ownValue(metadata, 'attempts'), 0, 20);
    const fault = ownValue(error, '$fault');
    return {
        stage: typeof stage === 'string' && stages.has(stage) ? stage : 'unknown',
        thrownKind, errorClass,
        ...(errorCode === undefined ? {} : { errorCode }),
        ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
        ...(attempts === undefined ? {} : { attempts }),
        ...(fault === 'client' || fault === 'server' ? { fault } : {})
    };
};
export const logFinalizationFailure = (stage: AttachmentFinalizationStage, error: unknown): void => {
    try {
        const diagnostic = finalizationDiagnostic(stage, error);
        console.error(`[attachments] complete failed (${diagnostic.errorClass})`, JSON.stringify(diagnostic));
    } catch { /* Diagnostic output must never replace the original HTTP result. */ }
};

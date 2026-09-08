import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListPartsCommand,
	PutObjectTaggingCommand,
	S3Client,
	UploadPartCommand,
	type CompletedPart
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';
import { fileTypeFromBuffer } from 'file-type';

import { getPrivateS3Config, type PrivateS3Config } from './config';

export type AttachmentUploadedPart = {
	partNumber: number;
	etag: string;
	sizeBytes: number;
	checksumSha256: string;
};

export type AttachmentObjectHead = {
	sizeBytes: number;
	checksumSha256: string;
	checksumType: string;
	attachmentId: string;
	versionId: string;
};

export type AttachmentS3 = {
	createMultipartUpload(input: { objectKey: string; attachmentId: string }): Promise<{ uploadId: string }>;
	signUploadPart(input: {
		objectKey: string;
		uploadId: string;
		partNumber: number;
		checksumSha256: string;
		contentLength: number;
	}): Promise<{ url: string; expiresAt: string; headers: Record<string, string> }>;
	listParts(input: { objectKey: string; uploadId: string }): Promise<AttachmentUploadedPart[]>;
	completeMultipartUpload(input: { objectKey: string; uploadId: string; parts: AttachmentUploadedPart[] }): Promise<{ versionId: string }>;
	headObject(input: { objectKey: string; versionId?: string }): Promise<AttachmentObjectHead>;
	detectContentType(input: { objectKey: string; versionId: string }): Promise<string | undefined>;
	markObjectReady(input: { objectKey: string; versionId: string }): Promise<void>;
	abortMultipartUpload(input: { objectKey: string; uploadId: string }): Promise<void>;
	deleteObject(input: { objectKey: string; versionId: string }): Promise<void>;
	signDownload(input: {
		objectKey: string;
		versionId: string;
		contentDisposition: string;
		contentType: string;
	}): Promise<{ url: string; expiresAt: string }>;
	isNoSuchUpload(error: unknown): boolean;
	isNotFound(error: unknown): boolean;
};

const PART_URL_TTL_SECONDS = 10 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;
const PREFIX_BYTES = 8 * 1024;

const errorName = (error: unknown) => String((error as any)?.name || (error as any)?.Code || '');
const errorStatus = (error: unknown) => Number((error as any)?.$metadata?.httpStatusCode || 0);

const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

let cached:
	| {
			key: string;
			value: AttachmentS3;
	  }
	| undefined;

const makeClient = (config: PrivateS3Config) =>
	new S3Client({
		region: config.region,
		maxAttempts: 3,
		credentials: awsCredentialsProvider({
			roleArn: config.roleArn,
			roleSessionName: 'thingtime-private-s3',
			clientConfig: { region: config.region }
		})
	});

type PresignUrl = (client: S3Client, command: UploadPartCommand | GetObjectCommand, options: any) => Promise<string>;

export const createPrivateS3 = (config: PrivateS3Config, client = makeClient(config), presign: PresignUrl = getSignedUrl): AttachmentS3 => {
	const common = { Bucket: config.bucket, ExpectedBucketOwner: config.expectedBucketOwner } as const;

	return {
		async createMultipartUpload({ objectKey, attachmentId }) {
			const result = await client.send(
				new CreateMultipartUploadCommand({
					...common,
					Key: objectKey,
					CacheControl: 'private, max-age=0, must-revalidate',
					ContentDisposition: 'attachment',
					ContentType: 'application/octet-stream',
					ServerSideEncryption: 'AES256',
					ChecksumAlgorithm: 'SHA256',
					ChecksumType: 'COMPOSITE',
					Metadata: { 'attachment-id': attachmentId },
					Tagging: 'thingtime-state=pending'
				})
			);
			if (!result.UploadId) throw new Error('S3 did not return a multipart upload id');
			return { uploadId: result.UploadId };
		},

		async signUploadPart({ objectKey, uploadId, partNumber, checksumSha256, contentLength }) {
			const command = new UploadPartCommand({
				...common,
				Key: objectKey,
				UploadId: uploadId,
				PartNumber: partNumber,
				ChecksumSHA256: checksumSha256,
				ContentLength: contentLength
			});
			const url = await presign(client, command, {
				expiresIn: PART_URL_TTL_SECONDS,
				// A checksum in the query could be stripped or rewritten by browser
				// URL handling. Keep it as a required signed request header.
				unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
				signableHeaders: new Set(['content-length', 'x-amz-checksum-sha256'])
			});
			return {
				url,
				expiresAt: expiresAt(PART_URL_TTL_SECONDS),
				headers: { 'x-amz-checksum-sha256': checksumSha256 }
			};
		},

		async listParts({ objectKey, uploadId }) {
			const parts: AttachmentUploadedPart[] = [];
			let marker: string | undefined;
			do {
				const page = await client.send(
					new ListPartsCommand({
						...common,
						Key: objectKey,
						UploadId: uploadId,
						PartNumberMarker: marker,
						MaxParts: 1000
					})
				);
				for (const part of page.Parts || []) {
					if (!Number.isInteger(part.PartNumber) || !part.ETag || !Number.isSafeInteger(part.Size) || !part.ChecksumSHA256) {
						throw new Error('S3 returned incomplete multipart metadata');
					}
					parts.push({
						partNumber: Number(part.PartNumber),
						etag: part.ETag,
						sizeBytes: Number(part.Size),
						checksumSha256: part.ChecksumSHA256
					});
				}
				marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
				if (page.IsTruncated && !marker) throw new Error('S3 returned an invalid multipart cursor');
			} while (marker);
			return parts;
		},

		async completeMultipartUpload({ objectKey, uploadId, parts }) {
			const completedParts: CompletedPart[] = parts.map((part) => ({
				PartNumber: part.partNumber,
				ETag: part.etag,
				ChecksumSHA256: part.checksumSha256
			}));
			const response = await client.send(
				new CompleteMultipartUploadCommand({
					...common,
					Key: objectKey,
					UploadId: uploadId,
					MultipartUpload: { Parts: completedParts },
					ChecksumType: 'COMPOSITE'
				})
			);
			return { versionId: String(response.VersionId || '') };
		},

		async headObject({ objectKey, versionId }) {
			const head = await client.send(
				new HeadObjectCommand({
					...common,
					Key: objectKey,
					...(versionId ? { VersionId: versionId } : {}),
					ChecksumMode: 'ENABLED'
				})
			);
			return {
				sizeBytes: Number(head.ContentLength),
				checksumSha256: String(head.ChecksumSHA256 || ''),
				checksumType: String(head.ChecksumType || ''),
				attachmentId: String(head.Metadata?.['attachment-id'] || head.Metadata?.attachmentid || ''),
				versionId: String(head.VersionId || '')
			};
		},

		async detectContentType({ objectKey, versionId }) {
			const object = await client.send(
				new GetObjectCommand({
					...common,
					Key: objectKey,
					VersionId: versionId,
					Range: `bytes=0-${PREFIX_BYTES - 1}`
				})
			);
			const bytes = await object.Body?.transformToByteArray();
			if (!bytes?.byteLength) return undefined;
			return (await fileTypeFromBuffer(bytes))?.mime;
		},

		async markObjectReady({ objectKey, versionId }) {
			await client.send(
				new PutObjectTaggingCommand({
					...common,
					Key: objectKey,
					VersionId: versionId,
					Tagging: { TagSet: [{ Key: 'thingtime-state', Value: 'ready' }] }
				})
			);
		},

		async abortMultipartUpload({ objectKey, uploadId }) {
			await client.send(
				new AbortMultipartUploadCommand({
					...common,
					Key: objectKey,
					UploadId: uploadId
				})
			);
		},

		async deleteObject({ objectKey, versionId }) {
			await client.send(new DeleteObjectCommand({ ...common, Key: objectKey, VersionId: versionId }));
		},

		async signDownload({ objectKey, versionId, contentDisposition, contentType }) {
			const command = new GetObjectCommand({
				...common,
				Key: objectKey,
				VersionId: versionId,
				ResponseCacheControl: 'private, max-age=0, must-revalidate',
				ResponseContentDisposition: contentDisposition,
				ResponseContentType: contentType
			});
			return {
				url: await presign(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS }),
				expiresAt: expiresAt(DOWNLOAD_URL_TTL_SECONDS)
			};
		},

		isNoSuchUpload(error) {
			return errorName(error) === 'NoSuchUpload' || (errorStatus(error) === 404 && errorName(error).includes('Upload'));
		},

		isNotFound(error) {
			return errorStatus(error) === 404 || ['NoSuchKey', 'NotFound'].includes(errorName(error));
		}
	};
};

export const getPrivateS3 = (): AttachmentS3 => {
	const config = getPrivateS3Config();
	const key = `${config.roleArn}\0${config.bucket}\0${config.region}`;
	if (cached?.key === key) return cached.value;
	const value = createPrivateS3(config);
	cached = { key, value };
	return value;
};

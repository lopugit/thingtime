import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectTaggingCommand,
	S3Client,
	UploadPartCommand
} from '@aws-sdk/client-s3';

import { createPrivateS3 } from './privateS3';

test('multipart creation omits ACLs and fixes encryption, checksum, metadata, and pending tag', async () => {
	const commands: any[] = [];
	const client = {
		send: async (command: any) => {
			commands.push(command);
			return { UploadId: 'mpu-1' };
		}
	};
	const s3 = createPrivateS3(
		{
			roleArn: 'arn:aws:iam::232261468846:role/thingtime',
			bucket: 'example-private-bucket',
			region: 'ap-southeast-2',
			expectedBucketOwner: '232261468846'
		},
		client as any
	);

	assert.deepEqual(await s3.createMultipartUpload({ objectKey: 'objects/one', attachmentId: 'one' }), {
		uploadId: 'mpu-1'
	});
	assert.equal(commands.length, 1);
	assert.ok(commands[0] instanceof CreateMultipartUploadCommand);
	const input = commands[0].input;
	assert.equal(Object.prototype.hasOwnProperty.call(input, 'ACL'), false);
	assert.equal(input.ServerSideEncryption, 'AES256');
	assert.equal(input.ChecksumAlgorithm, 'SHA256');
	assert.equal(input.ChecksumType, 'COMPOSITE');
	assert.deepEqual(input.Metadata, { 'attachment-id': 'one' });
	assert.equal(input.Tagging, 'thingtime-state=pending');
	assert.equal(input.ExpectedBucketOwner, '232261468846');
});

test('presigned UploadPart binds exact Content-Length and checksum as signed headers', async () => {
	let command: any;
	let options: any;
	const s3 = createPrivateS3(
		{
			roleArn: 'arn:aws:iam::232261468846:role/thingtime',
			bucket: 'example-private-bucket',
			region: 'ap-southeast-2',
			expectedBucketOwner: '232261468846'
		},
		{} as any,
		async (_client, inputCommand, inputOptions) => {
			command = inputCommand;
			options = inputOptions;
			return 'https://s3.example/signed';
		}
	);
	const digest = Buffer.alloc(32, 7).toString('base64');
	const signed = await s3.signUploadPart({
		objectKey: 'objects/one',
		uploadId: 'mpu-1',
		partNumber: 2,
		checksumSha256: digest,
		contentLength: 2 * 1024 * 1024
	});

	assert.ok(command instanceof UploadPartCommand);
	assert.equal(command.input.ContentLength, 2 * 1024 * 1024);
	assert.equal(command.input.ChecksumSHA256, digest);
	assert.equal(options.signableHeaders.has('content-length'), true);
	assert.equal(options.signableHeaders.has('x-amz-checksum-sha256'), true);
	assert.equal(options.unhoistableHeaders.has('x-amz-checksum-sha256'), true);
	assert.deepEqual(signed.headers, { 'x-amz-checksum-sha256': digest });
	assert.equal(Object.prototype.hasOwnProperty.call(signed.headers, 'content-length'), false);
});

test('real presigner emits content-length and checksum in X-Amz-SignedHeaders', async () => {
	const config = {
		roleArn: 'arn:aws:iam::232261468846:role/thingtime',
		bucket: 'example-private-bucket',
		region: 'ap-southeast-2',
		expectedBucketOwner: '232261468846'
	};
	const client = new S3Client({
		region: config.region,
		credentials: { accessKeyId: 'TESTACCESSKEY', secretAccessKey: 'test-secret-key' }
	});
	const signed = await createPrivateS3(config, client).signUploadPart({
		objectKey: 'objects/one',
		uploadId: 'mpu-1',
		partNumber: 1,
		checksumSha256: Buffer.alloc(32, 9).toString('base64'),
		contentLength: 8 * 1024 * 1024
	});
	const signedHeaders = new URL(signed.url).searchParams.get('X-Amz-SignedHeaders') || '';
	const names = new Set(signedHeaders.split(';'));
	assert.equal(names.has('host'), true);
	assert.equal(names.has('content-length'), true);
	assert.equal(names.has('x-amz-checksum-sha256'), true);
});

test('every post-completion S3 operation targets the exact verified object version', async () => {
	const commands: any[] = [];
	let presignedCommand: any;
	const client = {
		send: async (command: any) => {
			commands.push(command);
			if (command instanceof CompleteMultipartUploadCommand) return { VersionId: 'opaque-version-1' };
			if (command instanceof HeadObjectCommand) {
				return {
					ContentLength: 1,
					ChecksumSHA256: 'checksum',
					ChecksumType: 'COMPOSITE',
					Metadata: { 'attachment-id': 'one' },
					VersionId: 'opaque-version-1'
				};
			}
			if (command instanceof GetObjectCommand) {
				return { Body: { transformToByteArray: async () => new Uint8Array([0]) } };
			}
			return {};
		}
	};
	const s3 = createPrivateS3(
		{
			roleArn: 'arn:aws:iam::232261468846:role/thingtime',
			bucket: 'example-private-bucket',
			region: 'ap-southeast-2',
			expectedBucketOwner: '232261468846'
		},
		client as any,
		async (_client, command) => {
			presignedCommand = command;
			return 'https://s3.example/signed';
		}
	);

	assert.deepEqual(
		await s3.completeMultipartUpload({
			objectKey: 'objects/one',
			uploadId: 'upload-1',
			parts: [{ partNumber: 1, etag: 'etag', sizeBytes: 1, checksumSha256: 'checksum' }]
		}),
		{ versionId: 'opaque-version-1' }
	);
	assert.equal((await s3.headObject({ objectKey: 'objects/one', versionId: 'opaque-version-1' })).versionId, 'opaque-version-1');
	await s3.detectContentType({ objectKey: 'objects/one', versionId: 'opaque-version-1' });
	await s3.markObjectReady({ objectKey: 'objects/one', versionId: 'opaque-version-1' });
	await s3.deleteObject({ objectKey: 'objects/one', versionId: 'opaque-version-1' });
	await s3.signDownload({
		objectKey: 'objects/one',
		versionId: 'opaque-version-1',
		contentDisposition: 'attachment',
		contentType: 'application/octet-stream'
	});

	for (const command of commands.filter(
		(entry) =>
			entry instanceof HeadObjectCommand ||
			entry instanceof GetObjectCommand ||
			entry instanceof PutObjectTaggingCommand ||
			entry instanceof DeleteObjectCommand
	)) {
		assert.equal(command.input.VersionId, 'opaque-version-1');
	}
	assert.ok(presignedCommand instanceof GetObjectCommand);
	assert.equal(presignedCommand.input.VersionId, 'opaque-version-1');
});

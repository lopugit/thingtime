import assert from 'node:assert/strict';
import test from 'node:test';

import { PrivateS3ConfigError, getPrivateS3Config } from './config';

test('private S3 config accepts only private role, bucket, and region values', () => {
	assert.deepEqual(
		getPrivateS3Config({
			THINGTIME_PRIVATE_S3_ROLE_ARN: 'arn:aws:iam::123456789012:role/thingtime-vercel-s3',
			THINGTIME_PRIVATE_S3_BUCKET: 'thingtime-private-example',
			THINGTIME_PRIVATE_S3_REGION: 'ap-southeast-2'
		} as NodeJS.ProcessEnv),
		{
			roleArn: 'arn:aws:iam::123456789012:role/thingtime-vercel-s3',
			bucket: 'thingtime-private-example',
			region: 'ap-southeast-2',
			expectedBucketOwner: '123456789012'
		}
	);
});

test('private S3 config rejects missing, dotted, and generic credential-shaped setup', () => {
	for (const env of [
		{},
		{
			THINGTIME_PRIVATE_S3_ROLE_ARN: 'arn:aws:iam::123456789012:role/thingtime',
			THINGTIME_PRIVATE_S3_BUCKET: 'dotted.bucket',
			THINGTIME_PRIVATE_S3_REGION: 'ap-southeast-2'
		},
		{
			AWS_ACCESS_KEY_ID: 'not-consumed',
			AWS_SECRET_ACCESS_KEY: 'not-consumed',
			THINGTIME_PRIVATE_S3_BUCKET: 'thingtime-private-example',
			THINGTIME_PRIVATE_S3_REGION: 'ap-southeast-2'
		}
	]) {
		assert.throws(() => getPrivateS3Config(env as NodeJS.ProcessEnv), PrivateS3ConfigError);
	}
});

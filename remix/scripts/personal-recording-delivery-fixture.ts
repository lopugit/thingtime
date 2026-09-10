export const deliverySmokeOptions = (origin: string, username?: string, password?: string) => {
	const url = new URL(origin);
	if (url.origin !== origin || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname))
		throw new Error('Use an exact loopback HTTP origin.');
	if (!username || !/^recqa[a-z0-9_-]{4,50}$/.test(username) || !password)
		throw new Error('Use a disposable recqa-prefixed account with approved uploads.');
	return { origin, username, password };
};

export const syntheticRecordingWav = () => {
	const bytes = Buffer.alloc(44 + 16000 * 2); // one second, mono PCM16 silence
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
	return bytes;
};

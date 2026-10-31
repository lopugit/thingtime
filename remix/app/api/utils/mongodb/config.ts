import { PublicError } from '../errors/safeError';

const MONGO_PASSWORD_PLACEHOLDER = '<db_password>';

// The only supported MongoDB environment variable pair is:
// - MONGODB_CONNECTION_STRING: Atlas URI containing the literal `<db_password>`
//   placeholder
// - MONGO_PASS: password substituted into that placeholder, URL-encoded so
//   special characters cannot corrupt the URI
export const getMongoUri = () => {
	const connectionString = process.env.MONGODB_CONNECTION_STRING;

	if (!connectionString) {
		throw new PublicError('MONGODB_CONNECTION_STRING is required');
	}

	if (!connectionString.includes(MONGO_PASSWORD_PLACEHOLDER)) {
		return connectionString;
	}

	const password = process.env.MONGO_PASS;

	if (!password) {
		throw new PublicError('MONGO_PASS is required when MONGODB_CONNECTION_STRING contains <db_password>');
	}

	return connectionString.split(MONGO_PASSWORD_PLACEHOLDER).join(encodeURIComponent(password));
};

// Strip protocol + credentials so a URI like
// `mongodb+srv://user:pass@cluster0.abc.mongodb.net/thingtime` is shown as
// `cluster0.abc.mongodb.net` and we never leak a password into the UI.
export const sanitiseMongoHost = (uri?: string | null): string | null => {
	if (!uri) return null;
	try {
		const withoutProtocol = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
		const withoutCredentials = withoutProtocol.replace(/^[^@]*@/, '');
		const host = withoutCredentials.split(/[/?]/)[0];
		return host || null;
	} catch {
		return null;
	}
};

import type { PublicUser } from '../auth/users';
import {
	getMigrationDiagnosticReveal,
	isMigrationDiagnosticId,
	type MigrationDiagnosticReveal
} from '../migrations/migrationDiagnostics';

export type SensitiveThingReveal = MigrationDiagnosticReveal;

type SensitiveRevealProvider = {
	matches: (thingId: string) => boolean;
	reveal: (user: PublicUser, thingId: string, reference: string) => Promise<SensitiveThingReveal | null>;
};

type SensitiveRevealDependencies = {
	getMigrationReveal: typeof getMigrationDiagnosticReveal;
};

// Closed provider registry: the public endpoint never accepts a kind, field,
// JSON path, or secure-blob selector. Supporting another protected Thing must
// add an explicit codec here with its own authorization and exact-value parser.
export const createSensitiveThingRevealer = (
	dependencies: SensitiveRevealDependencies = { getMigrationReveal: getMigrationDiagnosticReveal }
) => {
	const providers: readonly SensitiveRevealProvider[] = [
		{
			matches: isMigrationDiagnosticId,
			reveal: (user, thingId, reference) =>
				user.isAdmin ? dependencies.getMigrationReveal(user.id, thingId, reference) : Promise.resolve(null)
		}
	];

	return async (
		user: PublicUser,
		thingId: unknown,
		reference: unknown
	): Promise<SensitiveThingReveal | null> => {
		if (
			typeof thingId !== 'string' ||
			thingId.length > 256 ||
			typeof reference !== 'string' ||
			reference.length > 64
		) {
			return null;
		}
		const provider = providers.find((candidate) => candidate.matches(thingId));
		return provider ? provider.reveal(user, thingId, reference) : null;
	};
};

export const revealSensitiveThingValue = createSensitiveThingRevealer();

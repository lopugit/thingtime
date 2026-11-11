// Messenger compatibility names over the shared protected-content quota
// writer. Device mirrors use the same primitives directly; Messenger keeps
// these exports so the existing domain modules do not need mechanical churn.
import {
	deleteAccountedThing,
	deleteAccountedThings,
	insertAccountedThing,
	stampAccountedStorageDocument,
	updateAccountedThing,
	updateAccountedThings,
	withAccountedThingsTransaction,
	type AccountedThingMutationOptions
} from '../storage/accountedThings';

type MessengerPlane = 'active' | 'home';
type MessengerMutationOptions = Omit<AccountedThingMutationOptions, 'accountedPlane'> & {
	messengerPlane?: MessengerPlane;
};

const accountedOptions = (options: MessengerMutationOptions = {}): AccountedThingMutationOptions => {
	const { messengerPlane, ...rest } = options;
	return { ...rest, ...(messengerPlane ? { accountedPlane: messengerPlane } : {}) };
};

export const insertMessengerThing = (things: any, doc: any, options: MessengerMutationOptions = {}): Promise<any> =>
	insertAccountedThing(things, doc, accountedOptions(options));

export const updateMessengerThing = (things: any, filter: any, update: any, options: MessengerMutationOptions = {}): Promise<any> =>
	updateAccountedThing(things, filter, update, accountedOptions(options));

export const updateMessengerThings = (things: any, filter: any, update: any, options: MessengerMutationOptions = {}): Promise<any> =>
	updateAccountedThings(things, filter, update, accountedOptions(options));

export const deleteMessengerThing = (things: any, filter: any, options: MessengerMutationOptions = {}): Promise<any> =>
	deleteAccountedThing(things, filter, accountedOptions(options));

export const deleteMessengerThings = (things: any, filter: any, options: MessengerMutationOptions = {}): Promise<any> =>
	deleteAccountedThings(things, filter, accountedOptions(options));

export const stampMessengerStorageDocument = stampAccountedStorageDocument;

export const HOME_MESSENGER_STORAGE_OPTIONS = { messengerPlane: 'home' as const };

export const withMessengerStorageTransaction = <T>(work: (session: any) => Promise<T>, plane: MessengerPlane = 'active'): Promise<T> =>
	withAccountedThingsTransaction(work, plane);

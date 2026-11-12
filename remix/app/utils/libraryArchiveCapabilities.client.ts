import { LIBRARY_ARCHIVE_READ_REQUIREMENTS } from '~/schemas/libraryArchive';
import { requireThingtimeCapability, requireActiveThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';

export const createLibraryArchiveCapabilityChecker = (
  origin = requireThingtimeCapability, active = requireActiveThingtimeCapability
) => async (feature: string, minimum: string, expectedOrigin?: string, transport?: Parameters<typeof origin>[3]) => {
  await Promise.all([origin(feature, minimum, expectedOrigin, transport), active(feature, minimum, expectedOrigin, transport)]);
};

export const requireLibraryArchiveCapability = createLibraryArchiveCapabilityChecker();

export const createLibraryArchiveReadChecker = (
  origin = requireThingtimeCapability, active = requireActiveThingtimeCapability
) => {
  const check = createLibraryArchiveCapabilityChecker(origin, active);
  return async (expectedOrigin?: string, transport?: Parameters<typeof origin>[3]) => {
    await Promise.all(Object.entries(LIBRARY_ARCHIVE_READ_REQUIREMENTS).map(([feature, minimum]) => check(feature, minimum, expectedOrigin, transport)));
  };
};

export const requireLibraryArchiveRead = createLibraryArchiveReadChecker();

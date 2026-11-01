import { getJwtIssuer } from '../auth/jwt';
import { absoluteThirdPartyProfileMediaUrl } from '~/utils/profileMediaUrl';

export const thirdPartyProfileMediaUrl = (value: string | null | undefined): string | null =>
	absoluteThirdPartyProfileMediaUrl(value, getJwtIssuer());

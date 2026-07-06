import { defineHandler } from 'nitro/h3';

import { rootDataResponse } from '../../../app/root-data.server';

export default defineHandler((event) => rootDataResponse(event.req));

// Source-plan metadata only: no credentials, connection, or database mutation.
import { thingsIndexPlanEntries } from '../app/api/utils/mongodb/collections.ts';
import { summarizeThingIndexPlan } from '../app/api/utils/mongodb/indexAudit.ts';

const entries = await thingsIndexPlanEntries();
console.log(JSON.stringify({ summary: summarizeThingIndexPlan(entries), entries }, null, 2));

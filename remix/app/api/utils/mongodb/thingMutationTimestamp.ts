/** Operational root timestamps are server-controlled. Operator updates cannot
 * move them backwards, including on a node whose wall clock trails another's.
 * User crystal dates, inserts, replacements and aggregation pipelines retain
 * their own explicit semantics. Invalid/conflicting updates remain errors. */
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
export const monotonicThingUpdate = (update: any): any => {
  if (!update || Array.isArray(update) || !validDate(update.$set?.updatedAt)) return update;
  const proposed = update.$set.updatedAt;
  const previousMax = update.$max?.updatedAt;
  if (previousMax !== undefined && !validDate(previousMax)) return update;
  for (const [operator, fields] of Object.entries(update)) {
    if (operator === '$set' || operator === '$max' || !fields || typeof fields !== 'object') continue;
    if (Object.entries(fields).some(([key, value]) => key === 'updatedAt' || key.startsWith('updatedAt.') ||
      (operator === '$rename' && (value === 'updatedAt' || (typeof value === 'string' && value.startsWith('updatedAt.')))))) return update;
  }
  const { updatedAt: _updatedAt, ...set } = update.$set;
  const result = { ...update, $max: { ...update.$max, updatedAt: previousMax && previousMax.getTime() > proposed.getTime() ? previousMax : proposed } };
  if (Object.keys(set).length) result.$set = set;
  else delete result.$set;
  return result;
};

export const monotonicThingMutationParameters = (method: string, parameters: any[]): any[] => {
  if (['updateOne', 'updateMany', 'findOneAndUpdate'].includes(method)) {
    const update = monotonicThingUpdate(parameters[1]);
    return update === parameters[1] ? parameters : [parameters[0], update, ...parameters.slice(2)];
  }
  if (method !== 'bulkWrite' || !Array.isArray(parameters[0])) return parameters;
  const operations = parameters[0].map((operation: any) => {
    for (const kind of ['updateOne', 'updateMany']) if (operation?.[kind]) {
      const update = monotonicThingUpdate(operation[kind].update);
      return update === operation[kind].update ? operation : { ...operation, [kind]: { ...operation[kind], update } };
    }
    return operation;
  });
  return [operations, ...parameters.slice(1)];
};

export const withMonotonicThingTimestamps = (collection: any): any => new Proxy(collection, { get(target, property) {
  const value = target[property];
  if (typeof value !== 'function') return value;
  return (...parameters: any[]) => value.apply(target, monotonicThingMutationParameters(String(property), parameters));
} });

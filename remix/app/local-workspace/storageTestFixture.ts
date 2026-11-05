import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

/** Test-only browser capacity. Production IndexedDB has no Thingtime record or
 * byte quota. Inject its platform exception at the native store boundary so
 * existing atomic rollback and full-storage cleanup checks remain meaningful. */
export const TEST_STORAGE_CAPACITY = {
  records: 10_000, bytes: 64 * 1024 * 1024,
  recordBytes: 1024 * 1024, binaryBytes: 16 * 1024 * 1024
} as const;
type Capacity = { records: number; bytes: number };
const capacities = new WeakMap<IDBDatabase, Capacity>();
const originalPut = IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
  const capacity = capacities.get(this.transaction.db);
  if (capacity && this.name === 'usage') {
    const usage = value as { bytes: number; records: number };
    if (usage.bytes > capacity.bytes || usage.records > capacity.records)
      throw new DOMException('Synthetic browser capacity exhausted', 'QuotaExceededError');
  }
  return originalPut.call(this, value, key);
};

export function createQuotaFactory(limits: Partial<Capacity> = {}) {
  const factory = Object.assign(new IDBFactory(), {
    capacity: { bytes: TEST_STORAGE_CAPACITY.bytes, records: TEST_STORAGE_CAPACITY.records, ...limits }
  });
  const open = factory.open.bind(factory);
  factory.open = (...args) => {
    const request = open(...args);
    request.addEventListener('success', () => capacities.set(request.result, factory.capacity), { once: true });
    return request;
  };
  return factory;
}

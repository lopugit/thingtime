import { registerGatewayDrain, requireGatewayDatabaseAccess } from '../deployment/environmentGateway';
import type * as MongoDb from 'mongodb';

const clients = new Set<MongoDb.MongoClient>();
registerGatewayDrain(async () => {
  const idle = [...clients];
  clients.clear();
  await Promise.allSettled(idle.map(client => client.close()));
});

let modulePromise: Promise<typeof MongoDb> | undefined;
export const getMongoDb = async () => modulePromise ??= import('mongodb').then(mod => {
  class GatewayMongoClient extends mod.MongoClient {
    override async connect() {
      await requireGatewayDatabaseAccess();
      await super.connect();
      clients.add(this);
      return this;
    }
    override async close(force?: boolean) {
      clients.delete(this);
      await super.close(force);
    }
  }
  return { ...mod, MongoClient: GatewayMongoClient } as typeof mod;
});

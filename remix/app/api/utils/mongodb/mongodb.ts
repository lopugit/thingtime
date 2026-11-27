import { registerGatewayDrain, requireGatewayDatabaseAccess } from '../deployment/environmentGateway';
import { attachDatabasePool } from '@vercel/functions';
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
    constructor(uri: string, options?: MongoDb.MongoClientOptions) {
      super(uri, options);
      // Keep Fluid workers alive long enough for the driver's configured idle
      // timeout to retire application sockets before suspension. Zero means no
      // idle retirement; attaching such a client cannot provide that guarantee.
      if (this.options.maxIdleTimeMS > 0) attachDatabasePool(this);
    }
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

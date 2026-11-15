import { getSettingsCollection } from '../mongodb/collections';
import {
  DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL,
  normalizePrConflictResolverModelWaterfall,
  PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
  type PRConflictResolverModelId,
  type AiWorkflowBaseModel,
  type AiPreferredWaterfallSnapshot,
  validatePrConflictResolverModelWaterfall
} from './prConflictResolverModelWaterfallCore';

type StoreDependencies = {
  readModelCatalog?:()=>Promise<readonly (AiWorkflowBaseModel & {enabled?:boolean;available?:boolean})[]>;
  readStoredWaterfall: () => Promise<unknown>;
  writeStoredWaterfall: (waterfall: PRConflictResolverModelId[], updatedBy: string) => Promise<void>;
};

// The public workflow endpoint must reflect the current home-DB singleton on
// every request. Keep only a last-known-good value for an actual Mongo outage;
// a positive TTL can otherwise let separate warm serverless instances return
// an administrator's previous model order after a successful save.
export const createPrConflictResolverModelWaterfallStore = (dependencies: StoreDependencies) => {
  type CatalogModel=AiWorkflowBaseModel&{enabled?:boolean;available?:boolean};
  type Snapshot={waterfall:PRConflictResolverModelId[];models?:readonly CatalogModel[]};
  let lastKnownGood:Snapshot|null=null;
  const copyModels=(models:readonly CatalogModel[]|undefined)=>models?.map(model=>({...model,efforts:[...model.efforts],speeds:[...model.speeds]}));
  const readSnapshot=async():Promise<Snapshot>=>{
    try {
      const [stored,loaded]=await Promise.all([dependencies.readStoredWaterfall(),dependencies.readModelCatalog?.()]);
      const models=copyModels(loaded);
      const snapshot={waterfall:normalizePrConflictResolverModelWaterfall(stored,models),models};
      lastKnownGood=snapshot;
      return snapshot;
    } catch {
      return lastKnownGood??{waterfall:[...DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL]};
    }
  };
  const getWaterfall=async():Promise<PRConflictResolverModelId[]>=>[...(await readSnapshot()).waterfall];
  const setWaterfall=async(value:unknown,updatedBy:string):Promise<PRConflictResolverModelId[]>=>{
    const models=copyModels(await dependencies.readModelCatalog?.());
    const validated=validatePrConflictResolverModelWaterfall(value,models?.filter(model=>model.enabled!==false&&model.available!==false));
    if(validated.ok===false)throw new TypeError(validated.error);
    const waterfall=[...validated.waterfall];
    await dependencies.writeStoredWaterfall(waterfall,updatedBy);
    lastKnownGood={waterfall,models};
    return [...waterfall];
  };
  const getSnapshot=async():Promise<AiPreferredWaterfallSnapshot|PRConflictResolverModelId[]>=>{
    const snapshot=await readSnapshot();
    return snapshot.models?{waterfall:[...snapshot.waterfall],models:copyModels(snapshot.models.filter(model=>model.enabled!==false&&model.available!==false))!}:[...snapshot.waterfall];
  };
  return { getWaterfall, setWaterfall, getSnapshot };
};

export const readPublishedAiWorkflowModelCatalog = async () => (await (await import('../ai/models')).listAiModels()).models;

const store = createPrConflictResolverModelWaterfallStore({
  readModelCatalog:readPublishedAiWorkflowModelCatalog,
  readStoredWaterfall: async () => {
    const doc = await (await getSettingsCollection()).findOne(
      { key: PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY },
      { projection: { _id: 0, waterfall: 1 } }
    );
    return doc?.waterfall;
  },
  writeStoredWaterfall: async (waterfall, updatedBy) => {
    await (await getSettingsCollection()).updateOne(
      { key: PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY },
      {
        $set: {
          key: PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
          waterfall,
          updatedAt: new Date(),
          updatedBy
        }
      },
      { upsert: true }
    );
  }
});

export const getPrConflictResolverModelWaterfall = store.getWaterfall;
export const setPrConflictResolverModelWaterfall = store.setWaterfall;

// Canonical runtime alias. Keep the legacy exports above for the public API,
// Admin editor, and existing workflow consumers.
export const getAiPreferredModelWaterfall = store.getSnapshot;

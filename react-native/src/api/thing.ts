import { client } from './client';

// Mirrors the Thingtime API in api/src/index.js:
//   GET /v1/thing?request=get&uuid=<uuid>  -> { thing: <serialized> }
//   GET /v1/thing?thing=<serialized>       -> saves the thing
//
// The web app serializes/parses with `smarts`. On mobile we keep the payload
// as-is and best-effort JSON.parse it, so the transport stays dependency-light.

export type Thing = Record<string, any>;

function tryParse(serialized: unknown): Thing | string | null {
  if (typeof serialized !== 'string') {
    return (serialized as Thing) ?? null;
  }
  try {
    return JSON.parse(serialized);
  } catch {
    return serialized;
  }
}

export async function getThing(uuid: string): Promise<Thing | string | null> {
  const { data } = await client.get('/v1/thing', {
    params: { request: 'get', uuid }
  });
  return tryParse(data?.thing);
}

export async function saveThing(serializedThing: string): Promise<void> {
  await client.get('/v1/thing', {
    params: { thing: serializedThing }
  });
}

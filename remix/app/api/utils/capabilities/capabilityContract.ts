export const THINGTIME_CAPABILITY_MANIFEST_PATH = '/.well-known/thingtime-capabilities.json';

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export const capabilitySatisfies = (version: string, required: string) => {
  const actualMatch = SEMVER.exec(version);
  const requiredMatch = SEMVER.exec(required);
  if (!actualMatch || !requiredMatch) return false;
  const actual = actualMatch.slice(1).map(Number);
  const minimum = requiredMatch.slice(1).map(Number);
  return actual[0] === minimum[0] && (
    actual[1] > minimum[1] ||
    (actual[1] === minimum[1] && actual[2] >= minimum[2])
  );
};

import { LocalThings } from '/workspace/thingtime/remix/app/local-workspace/things.ts';
const original = LocalThings.prototype.import;
LocalThings.prototype.import = function (input, folderId, files, signal) {
  return original.call(this, input, folderId, files, signal);
};

import { showHUD, showToast, Toast } from "@raycast/api";
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);
const commanderBundleIdentifier = "com.thingtime.Commander";

export default async function Command() {
  try {
    await run("/usr/bin/open", ["-b", commanderBundleIdentifier]);
    await showHUD("Commander opened");
  } catch {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not open Commander",
      message: "Install Commander in your Applications folder, then try again.",
    });
  }
}

import { exec, execSync } from "child_process";

export const openNewFinderWindow = async (props: any) => {
  // open a new finder window in the current mac desktop
  // execSync(`open -a Finder ${process.cwd()}`);

  // move newly opened finder window to currently focused mac desktop
  // execSync(`osascript -e 'tell application "Finder" to set the bounds of the first window to {0, 0, 1440, 900}'`);

  const { path } = props?.arguments;

  console.log("Path is", path);

  // TODO: Get Path working
  // not working:
  // execSync(`osascript -e 'te ll application "Finder" to make new Finder window at ${path}'`);
  // execSync(`osascript -e 'tell application "Finder" to make new Finder window at POSIX file "${path}"'`);
  // execSync(`osascript -e 'tell application "Finder" to open POSIX file "${path}"'`);

  execSync(`osascript -e 'tell application "Finder" to make new Finder window'`);

  // then focus on the new finder window
  execSync(`osascript -e 'tell application "Finder" to activate'`);

  return true;
};

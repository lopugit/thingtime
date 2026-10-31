import { exec, execSync, spawn } from "child_process";

export const regexTrim = async (props: any) => {
  /**
   * ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
   * This will turn a string into a regex search pattern, this is step 1
   */

  // open a new finder window in the current mac desktop
  // execSync(`open -a Finder ${process.cwd()}`);

  // move newly opened finder window to currently focused mac desktop
  // execSync(`osascript -e 'tell application "Finder" to set the bounds of the first window to {0, 0, 1440, 900}'`);

  // const { path } = props?.arguments;

  // console.log("Path is", path);

  // TODO: Get Path working
  // not working:
  // execSync(`osascript -e 'te ll application "Finder" to make new Finder window at ${path}'`);
  // execSync(`osascript -e 'tell application "Finder" to make new Finder window at POSIX file "${path}"'`);
  // execSync(`osascript -e 'tell application "Finder" to open POSIX file "${path}"'`);

  // execSync(`osascript -e 'tell application "Finder" to make new Finder window'`);

  // then focus on the new finder window
  // execSync(`osascript -e 'tell application "Finder" to activate'`);

  // so basically,
  // grab the clipboard text contents
  // and run this regex, (\s*\r*) gets replaced with (\s*\r*)
  const clipboardText = execSync(`pbpaste`).toString();

  // trim the actual clipboardText
  const trimmedClipboardText = clipboardText.trim();

  // also escape all native regex characters such as [ ] ( ) etc
  const escapedClipboardText = trimmedClipboardText.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

  const regex = /([\s\r]+)/g;
  const trimmedText = escapedClipboardText.replace(regex, "(\\s*\\r*)");

  console.log("Trimmed Text", trimmedText);

  // escape the trimmed text
  // and copy it back to clipboard
  // const escapedText = trimmedText.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

  // ignore newlines when copying to clipboard
  // const escapedText = trimmedText.replace(/\n/g, "\\n");

  // escape carriage returns when copying to clipboard
  // const escapedText = trimmedText.replace(/\\r/g, "\\\r");

  // use echo
  // execSync(`echo "${trimmedText}" | pbcopy`);

  // use printf
  // execSync(`printf "%s" "${trimmedText}" | pbcopy`);

  // use pbcopy directly
  const pbcopy = spawn("pbcopy");
  pbcopy.stdin.write(trimmedText);
  pbcopy.stdin.end();

  return true;
};

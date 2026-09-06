import { execSync, spawn } from "child_process";

const REPLACEMENT_ESCAPES = new Set(["{", "[", "\\", "]", "}", "."]);

export const unescapeRegexReplacementText = (value: string): string => {
  let result = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const escapedCharacter = value[index + 1];

    if (character === "\\" && escapedCharacter !== undefined && REPLACEMENT_ESCAPES.has(escapedCharacter)) {
      result += escapedCharacter;
      index += 1;
      continue;
    }

    result += character;
  }

  return result;
};

export const regexToReplacementConverter = async (props: any) => {
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

  // tage the string that looks like a regex
  // \{(\s*\r*)when:(\s*\r*)\["mall_condition"\],(\s*\r*)suffix:(\s*\r*)"-CUP"(\s*\r*)\},
  // and replace all the groups with $1, $2, $3, $4, $5, $6 etc..
  // for now just replace (\s*\r*) with $1, $2 and so on..

  const clipBoardArraySplit = clipboardText.split("(\\s*\\r*)");

  // log the array
  console.log("Clipboard Array Split", clipBoardArraySplit);

  let newValue = "";

  // stitch back together but with $1, $2, $3 etc..
  clipBoardArraySplit.forEach((item, index) => {
    // no need on the last index
    if (index === clipBoardArraySplit.length - 1) {
      newValue += item;
      return;
    }

    newValue += item + `$${index + 1}`;
  });

  // Decode only escapes that were present in the original input: \{ \\ \[ \] \} \.
  //
  // ONE left-to-right pass, not a chain of .replace() calls: a single pass consumes each
  // backslash together with the character it escapes, so a backslash produced by unescaping
  // \\ is never unescaped a second time (\\] stays \], not ]).
  // Chaining a separate replace per character double-unescaped the same backslash: `\\}` should
  // unescape to `\}` (a literal backslash, then a brace), but the old `\\` -> `\` pass produced a
  // fresh backslash that the following `\}` -> `}` pass then consumed, silently eating it and
  // yielding `}` — an escaped backslash before a brace or bracket was simply lost. A single pass
  // cannot feed its own output back in.
  newValue = unescapeRegexReplacementText(newValue);

  // const regex = /([\s\r]+)/g;
  // const trimmedText = escapedClipboardText.replace(regex, "(\\s*\\r*)");

  // console.log("Trimmed Text", trimmedText);

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
  pbcopy.stdin.write(newValue);
  pbcopy.stdin.end();

  return true;
};

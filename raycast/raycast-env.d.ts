/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Image Input - Where to obtain the image to modify. */
  "inputMethod": "Finder" | "Path Finder" | "Clipboard",
  /** Image Output - How to handle the result of the image modification, i.e. where to save the modified image, or whether to copy it to the clipboard. */
  "imageResultHandling": "replaceOriginal" | "saveInContainingFolder" | "copyToClipboard" | "openInPreview" | "saveToDownloads" | "saveToDesktop",
  /** cwebp Lossless - Whether to use lossless conversion */
  "cwebpLossless": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `openCommander` command */
  export type OpenCommander = ExtensionPreferences & {}
  /** Preferences accessible in the `commander` command */
  export type Commander = ExtensionPreferences & {
  /** Name of Command to run - The name of the command/function to run */
  "name-MagicInput"?: string
}
  /** Preferences accessible in the `commanderOpenNewFinderWindow` command */
  export type CommanderOpenNewFinderWindow = ExtensionPreferences & {
  /** Name of Command to run - The name of the command/function to run */
  "name-openNewFinderWindow"?: string
}
  /** Preferences accessible in the `commanderTrim` command */
  export type CommanderTrim = ExtensionPreferences & {
  /** Name of Command to run - The name of the command/function to run */
  "name-trim"?: string
}
  /** Preferences accessible in the `commanderMp4ToMp3` command */
  export type CommanderMp4ToMp3 = ExtensionPreferences & {
  /** Name of Command to run - The name of the command/function to run */
  "name-mp4ToMp3"?: string
}
  /** Preferences accessible in the `commanderConvert` command */
  export type CommanderConvert = ExtensionPreferences & {
  /** Name of Command to run - The name of the command/function to run */
  "name-convert"?: string,
  /** Additional - Whether to trim the image */
  "trim": boolean,
  /** Enabled Formats - Whether to show WEBP as a conversion option */
  "showWEBP": boolean,
  /**  - Whether to show ASTC as a conversion option */
  "showASTC": boolean,
  /**  - Whether to show BMP as a conversion option */
  "showBMP": boolean,
  /**  - Whether to show DDS as a conversion option */
  "showDDS": boolean,
  /**  - Whether to show EXR as a conversion option */
  "showEXR": boolean,
  /**  - Whether to show GIF as a conversion option */
  "showGIF": boolean,
  /**  - Whether to show HEIC as a conversion option */
  "showHEIC": boolean,
  /**  - Whether to show HEICS as a conversion option */
  "showHEICS": boolean,
  /**  - Whether to show ICNS as a conversion option */
  "showICNS": boolean,
  /**  - Whether to show ICO as a conversion option */
  "showICO": boolean,
  /**  - Whether to show JPEG as a conversion option */
  "showJPEG": boolean,
  /**  - Whether to show JP2 as a conversion option */
  "showJP2": boolean,
  /**  - Whether to show KTX as a conversion option */
  "showKTX": boolean,
  /**  - Whether to show PBM as a conversion option */
  "showPBM": boolean,
  /**  - Whether to show PDF as a conversion option */
  "showPDF": boolean,
  /**  - Whether to show PNG as a conversion option */
  "showPNG": boolean,
  /**  - Whether to show PSD as a conversion option */
  "showPSD": boolean,
  /**  - Whether to show PVR as a conversion option */
  "showPVR": boolean,
  /**  - Whether to show TGA as a conversion option */
  "showTGA": boolean,
  /**  - Whether to show TIFF as a conversion option */
  "showTIFF": boolean,
  /**  - Whether to show SVG as a conversion option */
  "showSVG": boolean
}
  /** Preferences accessible in the `commanderRegexTrim` command */
  export type CommanderRegexTrim = ExtensionPreferences & {
  /** Name of Command to run - The name of the command/function to run */
  "name-regexTrim"?: string
}
  /** Preferences accessible in the `commanderRegexToReplacementConverter` command */
  export type CommanderRegexToReplacementConverter = ExtensionPreferences & {
  /** Name of Command to run - The name of the command/function to run */
  "name-regexToReplacementConverter"?: string
}
}

declare namespace Arguments {
  /** Arguments passed to the `openCommander` command */
  export type OpenCommander = {}
  /** Arguments passed to the `commander` command */
  export type Commander = {}
  /** Arguments passed to the `commanderOpenNewFinderWindow` command */
  export type CommanderOpenNewFinderWindow = {
  /** Path */
  "path": string
}
  /** Arguments passed to the `commanderTrim` command */
  export type CommanderTrim = {}
  /** Arguments passed to the `commanderMp4ToMp3` command */
  export type CommanderMp4ToMp3 = {}
  /** Arguments passed to the `commanderConvert` command */
  export type CommanderConvert = {}
  /** Arguments passed to the `commanderRegexTrim` command */
  export type CommanderRegexTrim = {}
  /** Arguments passed to the `commanderRegexToReplacementConverter` command */
  export type CommanderRegexToReplacementConverter = {}
}


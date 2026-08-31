/**
 * @file operations/convertOperation.ts
 *
 * @summary Image conversion operation with support for basic image formats, SVGs, WebP, and PDFs.
 *
 * Created at     : 2023-07-dd 00:19:37
 * Last modified  : 2024-01-27 13:31:19
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import path from "path";

import { environment, getPreferenceValues } from "@raycast/api";

import { convertPDF, convertSVG, moveImageResultsToFinalDestination } from "../utilities/utils";
import { ConvertPreferences, ExtensionPreferences } from "../utilities/preferences";
import { ImageResultHandling } from "../utilities/enums";

/**
 * Converts images to the specified format, storing the results according to the user's preferences.
 *
 * @param sourcePaths The paths of the images to convert.
 * @param desiredType The desired format to convert the images to.
 * @returns A promise that resolves when the operation is complete.
 */
export default async function any(sourcePaths: string[], desiredType: string, trim?: boolean) {
  const preferences = getPreferenceValues<ExtensionPreferences>();

  const convertPreferences = getPreferenceValues<ConvertPreferences & ExtensionPreferences>();

  trim = trim || convertPreferences?.trim || desiredType?.includes("Trimmed");

  const resultPaths = [];
  for (const item of sourcePaths) {
    const extension = desiredType.toLowerCase()?.replace("trimmed", "");

    const pathComponents = item.split(".");
    let newPath = pathComponents.slice(0, -1).join("");

    if (preferences.imageResultHandling == ImageResultHandling.SaveToDownloads) {
      newPath = path.join(os.homedir(), "Downloads", path.basename(newPath));
    } else if (preferences.imageResultHandling == ImageResultHandling.SaveToDesktop) {
      newPath = path.join(os.homedir(), "Desktop", path.basename(newPath));
    } else if (
      preferences.imageResultHandling == ImageResultHandling.CopyToClipboard ||
      preferences.imageResultHandling == ImageResultHandling.OpenInPreview
    ) {
      newPath = path.join(os.tmpdir(), path.basename(newPath));
    }

    let iter = 2;
    while (fs.existsSync(newPath) && os.tmpdir() != path.dirname(newPath)) {
      newPath = path.join(
        path.dirname(newPath),
        path.basename(newPath, `.${desiredType.toLowerCase()}`) + ` (${iter})${path.extname(newPath)}`
      );
      iter++;
    }

    console.log("nik trim", trim);

    console.log("nik desiredType", desiredType);

    if (desiredType?.includes("Trimmed")) {
      desiredType = desiredType?.replace("Trimmed", "");
    }

    console.log("nik desiredType", desiredType);

    const trimmedPath = `${newPath}.${extension}`;
    if (trim) {
      newPath = `${newPath}.tmp.${extension}`;
    } else {
      newPath = `${newPath}.${extension}`;
    }

    console.log("nik desiredType", desiredType);

    if (desiredType === "MP3") {
      // const platform = os.arch() === "arm64" ? "/arm" : "/x86";
      // execSync(`chmod +x ${environment.assetsPath}/webp${platform}/cwebp`);
      // execSync(`${environment.assetsPath}/webp${platform}/cwebp ${preferences?.cwebpLossless ? '-lossless' : ''} "${item}" -o "${newPath}"`);
      // use ${item} as input.mp4 and ${newPath} as output.mp3
      execSync(`ffmpeg -i "${item}" -vn -ar 44100 -ac 2 -ab 320k -f mp3 "${newPath}"`);
      // resultPaths.push(newPath);
    } else if (desiredType === "Trim") {
      // using convert -trim ${item} ${newPath}
      execSync(`convert -trim "${item}" "${newPath}"`);
    } else if (desiredType === "WEBP") {
      // Input Format -> WebP
      // detect platform is arm or x86
      const platform = os.arch() === "arm64" ? "/arm" : "/x86";
      execSync(`chmod +x ${environment.assetsPath}/webp${platform}/cwebp`);
      execSync(
        `${environment.assetsPath}/webp${platform}/cwebp ${
          preferences?.cwebpLossless ? "-lossless" : ""
        } "${item}" -o "${newPath}"`
      );

      console.log("nik trim", trim);

      if (trim) {
        // const trimmedPath =
        // execSync(`echo $(which convert) >> /tmp/convert.txt`);
        // execSync(`convert -trim "${newPath}" "${trimmedPath}"`);
        // /opt/homebrew/bin/convert
        execSync(`/opt/homebrew/bin/convert -trim "${newPath}" "${trimmedPath}"`);

        // remove the tmp file
        fs.unlinkSync(newPath);
      }
    } else if (pathComponents.at(-1)?.toLowerCase() == "svg") {
      // SVG -> NSBitmapImageRep -> Desired Format
      convertSVG(desiredType, item, newPath);
    } else if (desiredType == "SVG") {
      const bmpPath = `${environment.supportPath}/tmp.bmp`;
      execSync(`chmod +x ${environment.assetsPath}/potrace/potrace`);
      if (pathComponents.at(-1)?.toLowerCase() == "webp") {
        // WebP -> PNG -> BMP -> SVG
        const pngPath = `${environment.supportPath}/tmp.png`;
        execSync(`chmod +x ${environment.assetsPath}/webp/dwebp`);
        execSync(`${environment.assetsPath}/webp/dwebp "${item}" -o "${pngPath}"`);
        execSync(
          `sips --setProperty format "bmp" "${pngPath}" --out "${bmpPath}" && ${environment.assetsPath}/potrace/potrace -s --tight -o "${newPath}" "${bmpPath}"; rm "${bmpPath}"; rm "${pngPath}"`
        );
      } else {
        // Input Format -> BMP -> SVG
        execSync(
          `sips --setProperty format "bmp" "${item}" --out "${bmpPath}" && ${environment.assetsPath}/potrace/potrace -s --tight -o "${newPath}" "${bmpPath}"; rm "${bmpPath}"`
        );
      }
    } else if (pathComponents.at(-1)?.toLowerCase() == "webp") {
      // WebP -> PNG -> Desired Format
      execSync(`chmod +x ${environment.assetsPath}/webp/dwebp`);
      execSync(`${environment.assetsPath}/webp/dwebp "${item}" -o "${newPath}"`);
      execSync(`sips --setProperty format ${desiredType.toLowerCase()} "${newPath}"`);
    } else if (pathComponents.at(-1)?.toLowerCase() == "pdf") {
      // PDF -> Desired Format
      const itemName = path.basename(item);
      const folderName = `${itemName?.substring(0, itemName.lastIndexOf("."))} ${desiredType}`;
      const folderPath = path.join(newPath.split("/").slice(0, -1).join("/"), folderName);
      execSync(`mkdir -p "${folderPath}"`);
      convertPDF(desiredType, item, folderPath);
    } else {
      // General Input Format -> Desired Format
      execSync(`sips --setProperty format ${desiredType.toLowerCase()} "${item}" --out "${newPath}"`);
    }

    resultPaths.push(newPath);
  }

  await moveImageResultsToFinalDestination(resultPaths);
}

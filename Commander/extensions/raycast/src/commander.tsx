import {
  Action,
  ActionPanel,
  getPreferenceValues,
  showToast,
  Toast,
  Icon,
  List,
  openCommandPreferences,
  closeMainWindow,
  showHUD,
} from "@raycast/api";

import any from "./operations/anyOperation";
import { getSelectedFiles, getSelectedImages } from "./utilities/utils";
import { ConvertPreferences, ExtensionPreferences } from "./utilities/preferences";
import runOperation from "./operations/runOperation";
import { openNewFinderWindow } from "./commands/openNewFinderWindow";
import { regexTrim } from "./commands/regexTrim";
import { regexToReplacementConverter } from "./commands/regexToReplacementConverter";

import { execSync } from "child_process";

/**
 * All supported image formats for conversion.
 */

const formats = ["MP3", "MP4"];

const convertFormats = [
  "WEBP",
  "WEBPTrimmed",
  "ASTC",
  "BMP",
  "DDS",
  "EXR",
  "GIF",
  "HEIC",
  "HEICS",
  "ICNS",
  "ICO",
  "JPEG",
  "JP2",
  "KTX",
  "PBM",
  "PDF",
  "PNG",
  "PSD",
  "PVR",
  "TGA",
  "TIFF",
  "SVG",
];

export default function Command(props: any) {
  const preferences = getPreferenceValues();

  console.log("Preference Name", preferences.name);

  // get all object keys of preferences
  const preferenceKeys = Object.keys(preferences);
  // find a key that starts with name- and return the value
  const preferenceNameKey = preferenceKeys.find((key) => key.startsWith("name-")) || "";

  const preferenceName = preferenceNameKey?.replace("name-", "");

  console.log("preferenceName", preferenceName);

  if (preferenceName === "trim") {
    (async () => {
      // get selected files
      console.log("getting selected files");

      const selectedFiles = await getSelectedFiles();

      // get selected images
      console.log("getting selected images");

      const selectedImages = await getSelectedImages();

      console.log("running trim operation");

      // log selectedImages length
      console.log("selectedImages length", selectedImages.length);

      await runOperation({
        operation: () => any(selectedFiles, "Trim"),
        selectedImages: selectedImages,
        inProgressMessage: "Trimming in progress...",
        successMessage: "Trimmed",
        failureMessage: "Failed to trim",
      });

      await showHUD(`🌈 Trim 🦄`);
    })();

    return;
  }

  if (preferenceName === "openNewFinderWindow") {
    openNewFinderWindow(props);

    (async () => {
      await showHUD(`🌈 New Finder Window 🦄`);
    })();

    return;
  }

  if (preferenceName === "regexTrim") {
    regexTrim(props);

    (async () => {
      await showHUD(`🌈 Converted into Regex 🦄`);
    })();

    return;
  }

  if (preferenceName === "regexToReplacementConverter") {
    regexToReplacementConverter(props);

    (async () => {
      await showHUD(`🌈 Converted into Replacement Regex 🦄`);
    })();

    return;
  }

  // log preferences
  // console.log(preferences);

  if (Object.hasOwnProperty.call(preferences, "mp4ToMp3")) {
    console.log("here !");

    (async () => {
      const selectedFiles = await getSelectedFiles();

      await runOperation({
        operation: () => any(selectedFiles, "MP3"),
        selectedImages: selectedFiles,
        inProgressMessage: "Conversion in progress...",
        successMessage: "Converted",
        failureMessage: "Failed to convert",
      });

      await showHUD(`🌈 MP4 to MP3 🦄`);
    })();

    return;
  }


  if (preferenceName === "mp4ToMp3") {
    return (
      <List searchBarPlaceholder="Search video transformations...">
        <List.EmptyView
          title="No Formats Enabled"
          description="Enable formats in the command preferences (⌘⇧,)"
          icon={Icon.Image}
          actions={
            <ActionPanel>
              <Action
                title="Open Command Preferences"
                onAction={async () => await openCommandPreferences()}
                shortcut={{ modifiers: ["cmd", "shift"], key: "," }}
              />
            </ActionPanel>
          }

        />
        {formats.map((format) => {
          return (
            <List.Item
              title={format}
              key={format}
              actions={
                <ActionPanel>
                  <Action
                    title={`Convert to ${format}`}
                    onAction={async () => {
                      const selectedFiles = await getSelectedFiles();
                      await runOperation({
                        operation: () => any(selectedFiles, format),
                        selectedImages: selectedFiles,
                        inProgressMessage: "Conversion in progress...",
                        successMessage: "Converted",
                        failureMessage: "Failed to convert",
                      });
                    }}
                  />
                </ActionPanel>
              }

            />
          );
        })}
      </List>
    );
  }

  if (preferenceName === "convert") {
    return (
      <List searchBarPlaceholder="Search image transformations...">
        <List.EmptyView
          title="No Formats Enabled"
          description="Enable formats in the command preferences (⌘⇧,)"
          icon={Icon.Image}
          actions={
            <ActionPanel>
              <Action
                title="Open Command Preferences"
                onAction={async () => await openCommandPreferences()}
                shortcut={{ modifiers: ["cmd", "shift"], key: "," }}
              />
            </ActionPanel>
          }

        />
        {convertFormats.map((format) => {
          return (
            <List.Item
              title={format}
              key={format}
              actions={
                <ActionPanel>
                  <Action
                    title={`Convert to ${format}`}
                    onAction={async () => {
                      const selectedFiles = await getSelectedFiles();
                      await runOperation({
                        operation: () => any(selectedFiles, format),
                        selectedImages: selectedFiles,
                        inProgressMessage: "Conversion in progress...",
                        successMessage: "Converted",
                        failureMessage: "Failed to convert",
                      });
                    }}
                  />
                </ActionPanel>
              }

            />
          );
        })}
      </List>
    );
  }

  console.log("shouldn't be here...");

  return (
    <List searchBarPlaceholder="Search commands...">
      <List.EmptyView
        title="No Commands"
        description="Configure commands in preferences"
        icon={Icon.Image}
        actions={
          <ActionPanel>
            <Action
              title="Open Command Preferences"
              onAction={async () => await openCommandPreferences()}
              shortcut={{ modifiers: ["cmd", "shift"], key: "," }}
            />
          </ActionPanel>
        }

      />
    </List>
  );
}

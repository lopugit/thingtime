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

  console.log("nik preferences", preferences);

  console.log("Preference Name", preferences.name);

  if (preferences.name === "trim") {
    (async () => {
      const selectedFiles = await getSelectedFiles();

      const selectedImages = await getSelectedImages();

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

  if (preferences.name === "openNewFinderWindow") {
    openNewFinderWindow(props);

    (async () => {
      await showHUD(`🌈 New Finder Window 🦄`);
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

  console.log("nik hey?");

  if (preferences.name === "mp4ToMp3") {
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

  if (preferences.name === "convert") {
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

/**
 * @file convert.tsx
 *
 * @summary Raycast command to convert selected images between various formats.
 * @author Stephen Kaplan <skaplanofficial@gmail.com>
 *
 * Created at     : 2023-07-06 14:53:25
 * Last modified  : 2023-07-06 15:47:53
 */

import { Action, ActionPanel, getPreferenceValues, showToast, Toast, Icon, List, openCommandPreferences } from "@raycast/api";

import any from "./operations/anyOperation";
import { getSelectedFiles, getSelectedImages } from "./utilities/utils";
import { ConvertPreferences, ExtensionPreferences } from "./utilities/preferences";
import runOperation from "./operations/runOperation";
import { openNewFinderWindow } from "./commands/openNewFinderWindow";
import { execSync } from "child_process";

/**
 * All supported image formats for conversion.
 */

const formats = [
  "MP3",
  "MP4",
]

export default async function Command(props: any) {
  
  const preferences = getPreferenceValues()
  
  if (preferences.name === 'openNewFinderWindow') {
    
    openNewFinderWindow(props)
    
    // show toast of done
    await showToast({ title: "Done", style: Toast.Style.Success });
    
    // use echo "tell application \"System Events\" to key code 53" | osascript to close raycast
    execSync('osascript -e \'tell application "System Events" to key code 53\'')
    
    return
    
  }
  console.log('nik process.argv', process.argv)
  console.log('nik process.cwd()', process.cwd())
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

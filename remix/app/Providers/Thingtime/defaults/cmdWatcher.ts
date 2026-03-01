const value = {
  'cmdWatcherNotifier.sh': {
    content: `
    
#!/bin/bash

# 1. Automatically get the current user's UID
MY_UID=$(id -u $(whoami))
echo "👀 Registering watcher for UID: $MY_UID..."
seconds=5
echo "Waiting for commands taking longer than $seconds second to finish..."

# Arrays to keep track of how long processes live and what they are
declare -A pid_seen_count
declare -A pid_command

whitelistCmds=(
    "cp"
    "rm"
    "mv"
    "rsync"
    "npm"
    "yarn"
    "docker"
    "docker-compose"
    "git"
    "brew"
    "make"
    "cmake"
    "python"
    "pip"
    "pip3"
    "mvn"
    "gradle"
    "gradlew"
    "code"
    "idea"
    "clion"
    "goland"
    "webstorm"
    "pycharm"
    "phpstorm"
    "rider"
    "vscode"
)

while true; do
    # 2. Find running processes for the user
    # We only look at processes attached to a terminal (tty != "?") so your OS background tasks don't spam you.
    # We also ignore this script's own PID ($$) to prevent infinite loops.
    while read -r pid tty cmd; do
        if [[ -z "\${pid_seen_count[$pid]}" ]]; then
            pid_seen_count[$pid]=1
            pid_command[$pid]="$cmd"
        else
            ((pid_seen_count[$pid]++))
        fi
    done < <(ps -U "$MY_UID" -o pid=,tty=,args= | awk -v watcher_pid="$$" '$2 != "?" && $1 != watcher_pid')

    # 3. Check if tracked processes have finished
    for pid in "\${!pid_seen_count[@]}"; do
        # 'kill -0' safely checks if a process is still running
        if ! kill -0 "$pid" 2>/dev/null; then
            
            # If we saw it in more than 1 loop, it lasted > 1 second!
            if [[ \${pid_seen_count[$pid]} -gt $seconds ]]; then
                CMD="\${pid_command[$pid]}"
                
                # only use whitelisted commands
                if [[ ! " \${whitelistCmds[@]} " =~ " \${CMD%% *} " ]]; then
                  continue
                fi
                
                noti "$CMD" "Task Complete"
                # echo "✅ Notification sent for: $CMD"
            fi
            
            # Stop tracking this PID to free up memory
            unset pid_seen_count[$pid]
            unset pid_command[$pid]
            
        fi
    done

    # Check every second
    sleep 1
done
    
    
    `
  },
  usrLocalBin: {
    noti: {
      content: `
#!/bin/bash

# inject the first param passed into this script
# no -sound default 😂

# echo "$(which terminal-notifier)"

terminal-notifier -title "🌈🧠🦄" -sender com.apple.automator.noti -ignoreDnD -message "\${1}" -subtitle "\${2}"
      
      `
    },
  },
  '.bashrc/.bash_profile': {
    content: `
      
# run /Users/USER/things/code/lopugit/root/cmdWatcherNotifier.sh in the background to watch for long running commands and notify when they finish
cmdWatcherPath="/Users/USER/things/code/lopugit/root/cmdWatcherNotifier.sh"
cmdWatcher() {
  bash /Users/USER/things/code/lopugit/root/cmdWatcherNotifier.sh &
}
export -f cmdWatcher
cmdWatcherKill() {
  pkill -f cmdWatcherNotifier.sh

}
export -f cmdWatcherKill
cmdWatcherRestart() {
  cmdWatcherKill
  cmdWatcher
}
export -f cmdWatcherRestart

cmdWatcherRestart
      
      `
    }
  }
};

export default value;

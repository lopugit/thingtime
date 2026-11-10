# Initial vault clearance trial

This trial stopped before the UI: Chromium refused the fixture’s command-line
inspection because its launch did not enable the automation protocol flag. No
clearance result is claimed. The next fixture explicitly supplies the flag and
requires the actual browser command line to omit `--no-sandbox`. The container
network boundary remained enforced and cleanup left no owned runtime.

# Commander Linux host boundary

Linux reuses Commander’s React/TypeScript UI, Node daemon, Rust core, Raycast compatibility runtime, and protocol.
The native host may be implemented with a small Rust/GTK4 + WebKitGTK process or a .NET host where supported.

It must implement the same `NativeRequest` methods as macOS and Windows, backed by:

- XDG autostart or the desktop environment’s portal;
- global shortcut portal where available, with an explicit unsupported capability otherwise;
- StatusNotifierItem/AppIndicator tray integration;
- Secret Service for Thingtime tokens;
- xdg-open/portals for applications, URLs, file reveal, and folder selection;
- WebKitGTK with transparent surface, IME, accessibility, and drag/drop verification.

Linux is architecturally supported and source-portable, but runtime testing is intentionally deferred. Capability
negotiation must make missing desktop-environment features visible rather than pretending parity.

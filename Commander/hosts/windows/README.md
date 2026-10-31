# Commander Windows host

The Windows host is a thin **C# / .NET 8 / WPF** process around WebView2. It implements the same native bridge as
the macOS Swift shell and contains no product/business logic.

Responsibilities:

- create launcher, settings, tray, and native overlay windows;
- register the global hotkey and launch-at-login task;
- host WebView2 with transparent/acrylic-aware initialization and no white startup frame;
- supervise the bundled Node 22 daemon and Rust core;
- map credentials to Windows Credential Manager;
- implement native file/application opening, clipboard, picker, accessibility, IME, and drag/drop behavior;
- report runtime capabilities and WebView2 version through `@commander/protocol`.

The project targets `net8.0-windows` and `UseWPF=true`. Its typed bridge contract is present, but the executable
entry point and window/daemon implementation are deliberately not shipped in this macOS-first milestone. Windows
testing was explicitly deferred; do not claim the Windows host is runnable until those files land and are exercised
on Windows.

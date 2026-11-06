# Editable native menu controls

Saved record menus previously used inline details, expanding cards and moving the grid. The generic tt-menu / Chakra Menu primitive puts editable contents into a bounded native popover while retaining the Component DOM, scoped styles, delegated Actions and copied-page navigation.

The trigger supports sanitized custom content. Keyboard arrows, Home/End, typing, Space, Escape and Tab operate on enabled menu items; light dismissal and other open menus are handled by the browser. Popup placement follows viewport resize and scroll without granting authored CSS unrestricted positioning.

Dialogs invoked from a menu render beside the popup in the same Component/style/Action scope, so closing the menu cannot hide an active modal. Dismissal restores the correct trigger. Only an open dialog responds to its successful completion Action, preventing hidden sibling dialogs from stealing focus. closeDisabled blocks manual dismissal during a save while still accepting a successful completion. Chakra dialog custom close content now uses its bounded renderer too.

Validation: 13 renderer boundary tests pass; changed-file lint passes; typecheck remains at the existing 89-error baseline; client/platform/library/embed build passes. Browser checks pass for desktop/mobile menu placement, keyboard arrows/typeahead/Space/Escape, mouse and outside dismissal, successful menu-dialog Actions, delayed-save dismissal lock, modal typing and focus return, and Builder query navigation. Live HQ rollout remains a saved-Things migration and is not switched by this source change.

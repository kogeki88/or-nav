## 2024-11-01 - Missing ARIA Labels on Icon-Only Buttons
**Learning:** Found multiple instances where icon-only buttons (like Trash2 or Volume2) rely solely on the `title` attribute for accessibility. While `title` provides a tooltip, `aria-label` is strictly required for screen readers to reliably interpret the button's purpose when there is no visible text content.
**Action:** Always ensure icon-only interactive elements have an explicit `aria-label` alongside any `title` attribute for dual accessibility (hover tooltip + screen reader).

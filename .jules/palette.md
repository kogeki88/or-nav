## 2024-11-01 - Missing ARIA Labels on Icon-Only Buttons
**Learning:** Found multiple instances where icon-only buttons (like Trash2 or Volume2) rely solely on the `title` attribute for accessibility. While `title` provides a tooltip, `aria-label` is strictly required for screen readers to reliably interpret the button's purpose when there is no visible text content.
**Action:** Always ensure icon-only interactive elements have an explicit `aria-label` alongside any `title` attribute for dual accessibility (hover tooltip + screen reader).

## 2024-11-02 - WCAG "Label in Name" Violation with aria-label
**Learning:** Found instances where `aria-label`s were applied to buttons that contained visible text. If the `aria-label` text does not contain the visible text of the button (e.g., `<button aria-label="Mark Resolved">✓ Done</button>`), it violates the WCAG 2.5.3 "Label in Name" criterion. Furthermore, applying an `aria-label` overrides the visible text for screen readers, meaning dynamic text states (like "✓ Copied" vs "📋 Prompt") are hidden.
**Action:** Only apply `aria-label` to strictly icon-only buttons. Do not add `aria-label` to buttons containing visible text, especially if that text changes dynamically to indicate state.

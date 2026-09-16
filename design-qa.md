# Design QA — Dashboard layout polish

- Source visual truth: `/var/folders/0c/q4ybv0w114n37g1nn0j3744r0000gn/T/TemporaryItems/NSIRD_screencaptureui_PseWPk/Screenshot 2026-09-16 at 10.55.46.png`
- Implementation capture: current-run browser capture of `http://localhost:5173/` (desktop 1440×1000 and narrow 390×844).
- State: UP Business, September 2026, month-to-date; no user filters applied.

## Comparison history

### Iteration 1 — initial review

- [P1] Header controls read as separate, equally weighted buttons. The language, refresh, and export actions lacked a shared utility grouping, and the narrow view could visually crop the export control.
  - Fix: grouped language and refresh in a compact utility control; kept the platform switch as the primary context control; made export a clearly distinct primary action with an icon-only narrow state.
- [P2] Filters and search appeared as one unstructured strip, producing an overly large visual gap on wide layouts and an awkward wrap on narrow layouts.
  - Fix: separated filter fields from search/update metadata, with desktop alignment and an intentional stacked narrow layout.
- [P2] The desktop workspace stopped at a fixed maximum width, leaving unused dark canvas on wide monitors.
  - Fix: made the workspace flex to the available viewport while preserving readable internal grids.

### Iteration 2 — post-fix visual check

- Desktop 1440×1000: platform context, utility controls, and export now read in a clear sequence; filters align with the main content grid.
- Narrow 390×844: platform switch stays tappable, utility actions stay visible, export renders as a clear icon button, fields reflow to two columns, and search takes a full readable row.
- Primary interactions checked: platform switch, language button, refresh button, export button visibility, date/filter fields, search field.
- Console note: Recharts may emit initial layout-size warnings during hydration; charts render after layout and no functional control is blocked.

## Required fidelity surfaces

- **Fonts and typography:** existing Inter / Chinese fallback hierarchy retained; compact utility controls use consistent 11–12px labels and explicit ARIA labels.
- **Spacing and layout rhythm:** header actions, filters, cards, and charts now use a consistent 8–16px rhythm; no action is clipped at the narrow breakpoint.
- **Colors and visual tokens:** existing UPay dark/mint palette and semantic status colors retained; export remains the single bright primary action.
- **Image quality and assets:** existing UPay logo asset is unchanged; no replacement image assets were introduced.
- **Copy and content:** operational labels and data values are unchanged.

## Follow-up polish

- [P3] Consider a compact filter drawer only if the dashboard later gains more than six filter fields.

**final result: passed**

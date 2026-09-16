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

### Iteration 3 — cross-month filtering

- [P1] A date-range selection was implicitly limited by the selected month, so it could not represent an operational period spanning multiple months.
  - Fix: added an **All history** month scope. Selecting the cross-month basis starts from the full available history and keeps the start/end inputs independently bounded only by the data range.
- [P2] The range inputs looked like isolated form fields and did not make the direction or reset behaviour clear.
  - Fix: placed start and end fields in a dedicated range group with an arrow divider, native calendar controls, and an adjacent reset button. The narrow layout preserves both dates on one intentional grid row.
- [P2] The sidebar labels suggested separate pages even though the view is a single dashboard.
  - Fix: recast them as **Quick jump** actions: overview, BD ranking, agent/API ranking, and trend analysis each scroll to a meaningful dashboard section and select the matching ranking view where appropriate.
- Visual/interaction verification: used the local app to select cross-month mode (showing `01/01/2026 → 14/09/2026`), changed the range to August–September, then used Reset filters. Reset restored September month-to-date and its as-of date. Narrow-screen capture confirms the range group, reset action, and search field remain readable.

**final result: passed**

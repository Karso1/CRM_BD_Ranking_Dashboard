# Design QA — UPay Trend Intelligence

Reference: selected “Trend Intelligence” direction (`exec-a0abc050-1e8a-4597-b0e6-89bac76c4047.png`).

## Iteration 1

- P1: The existing page was still organized around a ranking table and did not match the selected analytics-first hierarchy.
- P1: UPay mint branding and the official logo were missing.
- P1: Trend, contribution, daily velocity, and exception views were absent.
- P2: The narrow preview wrapped the export label onto two lines.

## Fixes

- Rebuilt the information hierarchy around filters → KPI strip → analytics → detailed ranking.
- Added cumulative actual-vs-target, BD contribution, daily recharge, and attention visualizations backed by current filtered data.
- Applied the UPay dark/mint visual system and official UPay favicon asset.
- Preserved month, date range, BD, metric, entity type, search, language, refresh, and print/export interactions.
- Changed the mobile export action to an icon button to avoid wrapping.

## Final verification

- [x] Selected concept and implementation compared side-by-side.
- [x] Mobile layout remains readable at a 319 px preview width.
- [x] Filter controls, KPI values, charts, attention queue, and ranking content render from the September dataset.
- [x] Chinese and English labels are present.
- [x] `npm run lint` passes.
- [x] `npm run build` passes.
- [x] No blocking runtime error appeared in the browser accessibility tree.

Result: **Passed**.

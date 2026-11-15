# WaterWatch: E. coli source map

A static page for the Passaic River Water Watch project (station NBC-01, Nereid Boat Club dock, Rutherford, NJ).
It lines up the 2026 E. coli samples against rainfall, tide and mapped sewer and stormwater outfalls to narrow down likely sources.

## Views

1. **Rain and tide heatmap.** Geometric mean E. coli by 48-hour rainfall band and tide direction.
2. **Season timeline.** Daily rainfall above, each sample below.
3. **Outfall map.** Combined sewer overflows, stormwater (MS4) outfalls and Harbor Dischargers Group stations around the dock, with a nearest-outfall table.

## Data

| Data | Source | How it loads |
|---|---|---|
| NBC-01 samples and rain gauge log | [Passaic River Water Watch dataset](https://passaicwaterwatch.netlify.app/data/) (Haolin Li, CC BY 4.0) | Snapshot in `data/nbc01-2026.json` |
| Combined sewer overflow outfalls | NJDEP `Features/Utilities/MapServer/0` | Live, in the browser |
| Stormwater outfalls | NJDEP `Applications/MS4_Map/MapServer/5` | Live, in the browser |
| Regional bacteria stations | Water Quality Portal, organization `NJHDG` | Live, in the browser |
| Hourly rainfall | Open-Meteo historical archive (gridded reanalysis) | Live, in the browser |

`tide_phase` in the snapshot is derived from the recorded tide text (rising = flood, falling = ebb).
To update after new sampling, edit `data/nbc01-2026.json`.

## Run locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000/. The page needs to be served over http(s); opening `index.html` directly will not load the data file.

## Deploy

No build step. Publish the repository root with GitHub Pages or Netlify.

## Limits

One station and eleven visits can rank explanations, not prove a source. Most heatmap cells hold one or two samples.

Leaflet 1.9.4 is vendored under `vendor/leaflet` (BSD-2-Clause).

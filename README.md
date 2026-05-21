# Forest Fire Dashboard

Live, interactive dashboard of global fire activity — NASA satellite thermal anomalies layered with US incident data and NOAA fire-weather alerts.

**Live:** https://project-ed76a8dc-76a9-437f-af8.uc.r.appspot.com

Designed in the spirit of *Bret Victor* (immediate visual feedback, linked views, direct manipulation) and framed in the spirit of *Alan Kay* (data placed in systems context, multiple lenses on the same map).

---

## What you're looking at

| Layer | What it is | Source |
|---|---|---|
| Orange heat overlay | Thermal anomalies (likely fires) detected by VIIRS sensors aboard NOAA-20, ~375m resolution, twice daily | NASA GIBS WMS |
| Orange dots | Named, managed US wildland fire incidents — radius scales with acreage | NIFC WFIGS Current Incident Locations |
| Amber polygons | Active NOAA red-flag warnings + fire-weather watches | NOAA api.weather.gov |

All data is **fetched live** from the source APIs on every page load — no caching layer, no backend, no API keys required.

## Interactions

- **Hover or click** a fire dot or warning polygon → right sidebar updates with details.
- **Lens switcher** (top-right): Explorer / Firefighter / Climatologist / Resident — reframes the same data through different points of view.
- **Time scrubber** (bottom): drag back through the last 7 days; the satellite heat layer swaps to that day instantly. Hit ▶ to animate.
- **Click empty map** to clear selection and return to the big-picture narrative.

## Architecture

```
index.html (markup + shell)
  ↓
style.css (dark theme, grid layout, scrubber, sidebar)
  ↓
app.js  (single IIFE; Leaflet map + 3 data layers + interactions)
   ├── NASA GIBS WMS  ← thermal anomalies (raster, scrubbable by date)
   ├── NIFC ArcGIS    ← active US incidents (f=json, circle markers)
   └── NOAA NWS API   ← fire-weather alerts (GeoJSON polygons)

app.yaml (App Engine Standard config, free-tier capped)
```

No build step. No frameworks. Plain JS + Leaflet via CDN. Total page weight ~30KB.

## Deploy

Push to `main` → auto-deploy via GitHub Actions:

```bash
git add .
git commit -m "your message"
git push
```

The workflow at `.github/workflows/deploy.yml`:
1. Authenticates to GCP via **Workload Identity Federation** (no JSON keys stored anywhere).
2. Runs `gcloud app deploy` as the `github-deployer` service account (minimum-scope: App Engine Deployer + Service Admin + Cloud Build Editor + Storage Object Admin + Artifact Registry Writer, plus Service Account User on the App Engine default SA).
3. Promotes the new version to 100% traffic.

Manual deploy from local machine still works: `gcloud app deploy`.

## Free-tier guarantees

`app.yaml` is configured so it is mathematically impossible to exceed App Engine Standard's free tier:

```yaml
instance_class: F1            # 28 free instance-hours/day
automatic_scaling:
  max_instances: 1            # hard cap; can't run > 24 hr/day in total
  min_instances: 0            # scales to zero when idle
  min_idle_instances: 0
```

A Cloud Billing budget tripwire emails the project owner at the first cent of charge.

## License

Code: do as you like. Data: respect the source licenses (NASA EOSDIS, NIFC, NOAA — all public domain or open access).

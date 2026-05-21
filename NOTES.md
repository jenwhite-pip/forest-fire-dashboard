# Development notes

Hard-won knowledge from building this. Read before changing anything in `app.js` or `app.yaml`.

## Data source quirks

### NIFC WFIGS — field schema

The active-incidents service is at:
```
https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0
```

**`DailyAcres` does not exist as a field.** Many internet examples reference it — they're wrong (or pulling from a different layer). The correct fields are:
- `IncidentSize` (current size, double) — primary acreage field
- `DiscoveryAcres` (size at discovery, double) — fallback
- `FinalAcres` — only populated after the fire is out

Sending `DailyAcres` in `outFields` returns a generic 400 "Invalid query parameters" with no hint about which field is wrong.

### NIFC — geometry omission

`f=geojson` silently drops features whose geometry is null. The active layer has many such records, so `f=geojson` returns far fewer features than expected. **Use `f=json`** and read `attributes.InitialLatitude` / `attributes.InitialLongitude` directly. Filter on `ActiveFireCandidate=1` to skip records that aren't actively burning.

### NIFC — `maxRecordCount: 2000`

The service caps each query at 2000 records. The active-incidents count is currently under that, so it's fine. If we ever exceed 2000 we'll need to paginate with `resultOffset`.

### NASA GIBS — vector tiles only exist in EPSG:4326

The `GetCapabilities` document at `/wmts/epsg3857/best/wmts.cgi` *lists* the VIIRS/MODIS thermal anomaly layers with a Web Mercator URL template, but **all `.mvt` requests against that endpoint return 404**. The official Mapbox-GL style spec (`https://gibs.earthdata.nasa.gov/vector-styles/v1.0/FIRMS_VIIRS_Thermal_Anomalies.json`) reveals the truth: the tiles only exist under `/wmts/epsg4326/best/` with TileMatrixSet `500m`.

That's why this app uses the **WMS** endpoint (`/wms/epsg3857/best/wms.cgi`) instead of WMTS vector tiles — WMS reprojects on the server side, so it works with Leaflet's default Web Mercator. Trade-off: rasterized fires aren't individually clickable from this layer. Per-fire interactivity comes from the NIFC point markers (US only) and from the GIBS tiles being a heat overview.

### NOAA api.weather.gov

- Requires `Accept: application/geo+json` header to return GeoJSON-shaped responses.
- Does **not** accept a `limit` query parameter.
- Event names are case-sensitive: `Red Flag Warning`, `Fire Weather Watch`, `Extreme Fire Danger`.
- No API key needed, but they appreciate a `User-Agent` header that identifies your app + contact email (we can't set that from a browser; not a hard requirement).

## GCP new-project gotchas

These are documented elsewhere but bit us hard during setup:

1. **App Engine default SA has no IAM roles on brand-new projects.** Google removed the auto-Editor grant in 2024. Deploy fails with `staging.{project}.appspot.com … service account does not have access` until you run:
   ```
   gcloud projects add-iam-policy-binding $PROJECT \
     --member="serviceAccount:${PROJECT}@appspot.gserviceaccount.com" \
     --role="roles/editor" --condition=None
   ```
2. **Granting Editor at the project level is not enough.** Even after the project-level grant, the staging bucket may have its own IAM that doesn't include the SA. Grant explicitly:
   ```
   gcloud storage buckets add-iam-policy-binding gs://staging.$PROJECT.appspot.com \
     --member="serviceAccount:${PROJECT}@appspot.gserviceaccount.com" \
     --role="roles/storage.admin"
   ```
3. **Cloud Billing budget API: currency must match the billing account.** Our account is CAD; passing `--budget-amount=1USD` returns a generic `INVALID_ARGUMENT` with no detail. Use `1CAD` for this account.
4. **`gcloud billing budgets create --threshold-rule=percent=` takes a decimal, not an integer.** `percent=0.01` means 1%, not 0.01%. `percent=1.0` means 100%.

## Workload Identity Federation pattern

For GitHub Actions to deploy to GCP keylessly:

1. Create a deploy SA (`github-deployer@…`) with minimum roles. Don't reuse the App Engine default SA — keep blast radius small.
2. Create a Workload Identity Pool + GitHub OIDC provider. Constrain with `--attribute-condition="assertion.repository_owner == '…'"` so any repo under your GitHub account/org can be added later without re-creating the provider, but no other org can ever impersonate.
3. Bind the deploy SA to a `principalSet://…/attribute.repository/{owner}/{repo}` for each specific repo.
4. In GitHub Actions, use `google-github-actions/auth@v2` with `workload_identity_provider` + `service_account` (both from repo variables, not secrets — they aren't sensitive).

The deploy SA needs *exactly* these roles for App Engine Standard deploys; less and it'll fail with cryptic Cloud Build errors:
- `roles/appengine.deployer`
- `roles/appengine.serviceAdmin`
- `roles/cloudbuild.builds.editor`
- `roles/storage.objectAdmin`
- `roles/artifactregistry.writer`
- `roles/iam.serviceAccountUser` on the App Engine default SA

## Design decisions

- **Why Leaflet, not MapLibre-GL?** GIBS vector tiles aren't available in Web Mercator (see above). Switching to 4326 in MapLibre is fiddly. WMS raster + Leaflet keeps the code simple. Trade-off: the heat layer isn't individually clickable; we accept that.
- **Why no framework?** ~150 lines of UI logic. React/Vue/Svelte would more than double the line count and add a build step. Vanilla wins.
- **Why a "sticky" hover?** Standard `mouseover/mouseout` toggling feels jittery on small markers. We update the sidebar on hover and *keep* the detail visible until another hover or a click on empty map clears it. Selection persists through lens switches.
- **Why the lens switcher?** Same data, four points of view. The default Explorer framing is neutral; Firefighter surfaces tactical fields (complexity, GACC); Climatologist surfaces context (duration, cause class); Resident surfaces actionable info (containment, instruction text). This is the Alan Kay "point of view is worth 80 IQ points" move.

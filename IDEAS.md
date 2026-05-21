# Ideas / Roadmap

Things we talked about but didn't build, and things worth exploring next. Ordered roughly by effort × payoff.

## Low effort, high payoff

- **Drought overlay.** US Drought Monitor publishes weekly polygons (https://droughtmonitor.unl.edu/). Layering D2–D4 zones underneath fire incidents makes the climate signal viscerally obvious.
- **AQI / smoke layer.** AirNow (US) or OpenAQ (global) has live PM2.5. Adding a translucent smoke layer turns the dashboard from "where is fire?" to "where is fire hurting people?"
- **Share link with state in URL.** Encode `?lens=resident&day=3&fire=2026-CA-XXXX` in the URL so a specific selected view is shareable. Pure URL hash, no backend.
- **Mobile layout.** The CSS has a 900px breakpoint but the lens switcher hides on mobile and the sidebar takes too much height. Rework with bottom sheet UX.

## Medium effort

- **FIRMS API with MAP_KEY** for clickable global fire points. Today the global heat layer is raster (visual only); FIRMS gives you per-detection lat/lon + brightness + fire radiative power. Requires a free API key signup (`https://firms.modaps.eosdis.nasa.gov/api/`). Wire it as an optional layer that activates when a key is present.
- **NIFC perimeters layer.** The `WFIGS_Interagency_Perimeters_Current` feature service has actual polygon footprints (not just points). Drawing real perimeters at higher zooms would make the visualization much more honest about what a fire actually is.
- **Wind arrows.** Pull current wind direction/speed from NOAA gridpoints API at each active incident location. Render as small arrows. Gives the "is this fire about to blow up?" intuition at a glance.
- **Canada layer.** Natural Resources Canada has a CWFIS feed analogous to NIFC. With the user being Canadian, adding northern coverage is a nice touch and turns "US dashboard" into "North America dashboard."

## Bigger lifts

- **Time-series view.** Currently the scrubber jumps to a single day. A small companion strip showing "thermal anomaly count per day over the last 30 days" gives temporal context. Bret Victor's principle of "always show the relevant context."
- **Fire-weather forecast overlay.** NWS publishes 1–7 day fire weather outlook polygons (Storm Prediction Center FWO). Layering tomorrow's projected danger zones on top of today's incidents is the "what's about to be on fire" view.
- **Historical fires layer.** MTBS (Monitoring Trends in Burn Severity) has every US fire >1000 ac since 1984 with perimeters. Toggleable "burned this year / last 10 years / since 2000" overlay is the climate-change view.
- **Cloud Run + cached aggregates.** As traffic grows, fetching live every page-load won't scale. Stand up a tiny Cloud Run service that re-fetches NIFC + NOAA every 5 min and serves cached GeoJSON. Still fits free tier (2M req/mo). Avoids hammering NIFC.

## Bret Victor-y polish

- **Brushing.** Drag a box on the map → sidebar shows aggregate stats for that selection only.
- **Linked highlight.** Hover a row in the sidebar → corresponding marker on the map pulses.
- **"Why now?" panel.** When a fire is selected, fetch the NOAA forecast for that exact lat/lon and show RH/wind/temp over the next 24h alongside the fire's containment trend. Makes the system explicit.
- **Globe projection toggle.** A 3D globe view (e.g., via Cesium or MapLibre globe) for the "Climatologist" lens would be properly planetary.

## Alan Kay-y framing

- **Story mode.** A guided walk-through: "Here's the fuel build-up. Here's the dry frontal passage that triggered ignitions. Here's where the warnings were issued the day before. Here's where they came true." Built from past data, hand-curated for a recent significant event (e.g., the 2025 LA fires).
- **What-if sliders.** "If humidity dropped 10%, which red-flag zones would activate?" — clearly hypothetical, but the projection mechanism is what makes the system legible.

## Operational

- **Custom domain.** Map `fire-weather.{your-domain}` to the App Engine app. Free in App Engine; you only pay for the domain.
- **Lighthouse pass.** Quick audit: bundle Leaflet locally, drop unused CSS, lazy-load the lens narratives. Probably gets us a 95+ score.
- **Pre-commit hook** to validate `app.yaml` and lint JS so we never push a broken deploy.
- **Status badge** in README from GitHub Actions.

# Adding a 3D Location View to a Leaflet + OpenStreetMap App

The cleanest implementation is to keep Leaflet as your 2D map, then open a separate 3D viewer or modal when the user clicks a location. Leaflet is excellent for 2D raster and vector maps, but for true 3D scenes, it is better to hand off to a dedicated 3D map or graphics engine.

A typical flow looks like this:

```text
Leaflet map click
   ↓
Get latitude, longitude, and selected radius
   ↓
Fetch OpenStreetMap buildings within the radius
   ↓
Convert building footprints into GeoJSON
   ↓
Estimate building heights
   ↓
Open a 3D viewer modal
   ↓
Render extruded buildings, terrain, and location context
```

## Recommended Approach

### Option A: MapLibre 3D Extrusions

Use this if you want a 3D map-like view with extruded buildings.

MapLibre GL JS supports 3D building extrusion using `fill-extrusion` layers. This is ideal for showing nearby OpenStreetMap buildings as simple 3D blocks.

Recommended flow:

```text
Leaflet click → open modal → initialize MapLibre at clicked location → show 3D buildings in radius
```

Pros:

- Fast to implement.
- Feels like a modern 3D map.
- Good for city or neighborhood radius views.
- Works well with GeoJSON or vector tiles.

Cons:

- Buildings are simplified extrusions, not photorealistic 3D models.
- OpenStreetMap height data may be incomplete.

### Option B: CesiumJS

Use this if you want a more serious 3D globe, terrain, or geospatial scene.

CesiumJS supports 3D Tiles, terrain, point clouds, glTF models, and large geospatial datasets. It is better suited for advanced 3D, especially if your app may eventually use LiDAR, drone scans, photogrammetry, or detailed city-scale 3D data.

Pros:

- Best for real 3D geospatial experiences.
- Supports terrain, 3D Tiles, point clouds, and glTF models.
- Better long-term if you plan to add LiDAR, drone scans, or detailed city models.

Cons:

- More complex than MapLibre.
- Requires more preprocessing if you want performant radius-based 3D scenes.

### Option C: Three.js

Use this if you want a self-contained custom 3D model viewer for the clicked radius.

Pros:

- Full visual control.
- Can render building meshes, roads, markers, labels, and custom models.
- Good for a dedicated 3D scene viewer.

Cons:

- You need to handle camera controls, coordinate conversion, mesh generation, terrain, labels, and loading logic yourself.

For most apps starting from Leaflet and OpenStreetMap, the best first version is MapLibre. CesiumJS becomes more attractive later if you need terrain, 3D Tiles, LiDAR, or photogrammetry.

## Suggested First Version

Build the first version like this:

```text
Current app:
Leaflet + OpenStreetMap

New feature:
Click map location
→ open full-screen 3D modal
→ use MapLibre GL JS
→ fetch OpenStreetMap buildings within 300 meters
→ extrude footprints
→ show radius circle
→ allow user to adjust radius
```

This gives you a modern 3D feature without rebuilding your existing map stack.

## Minimal Product Behavior

When the user clicks a location, show an action such as:

```text
View 3D area
```

Then open a modal with:

- 3D extruded buildings.
- Radius boundary.
- Marker at the clicked point.
- Radius selector, such as 100m, 300m, 500m, or 1km.
- Close button to return to the Leaflet map.

## What to Avoid Initially

Avoid generating a unique downloadable 3D model on every click. That adds a lot of complexity, including meshing, geometry clipping, coordinate transformation, materials, caching, and export formats.

Instead, render the 3D scene dynamically from OpenStreetMap and GeoJSON first.

Later, you can add:

- Export as GLB.
- Export as 3D Tiles.
- Save this 3D area.
- Pre-generate high-demand areas.
- Add terrain, LiDAR, or drone scans.

## Backend Recommendation

Use a dedicated backend endpoint for 3D area data:

```http
GET /api/locations/3d?lat=14.5995&lng=120.9842&radius=300
```

Example response shape:

```json
{
  "center": {
    "lat": 14.5995,
    "lng": 120.9842
  },
  "radiusMeters": 300,
  "buildings": {
    "type": "FeatureCollection",
    "features": []
  },
  "metadata": {
    "source": "OpenStreetMap",
    "generatedAt": "2026-06-19T00:00:00Z"
  }
}
```

Backend responsibilities:

```text
1. Validate latitude, longitude, and radius.
2. Limit radius, such as max 500 meters or 1 kilometer.
3. Query cached data first.
4. Fetch OpenStreetMap or Overpass data only on cache miss.
5. Convert OSM data to GeoJSON.
6. Enrich building heights.
7. Return normalized GeoJSON.
```

Use hard radius limits. For example:

```js
const MAX_RADIUS_METERS = 1000;
```

Large Overpass queries can be slow and expensive, so caching is important.

## Data Considerations

OpenStreetMap building data is useful, but height data can be inconsistent. Some buildings may have `height` or `building:levels`, while many may only have footprints.

A practical fallback is:

```text
Use height if available.
Otherwise use building:levels × 3 meters.
Otherwise default to about 6 meters.
```

You can improve this later with:

- Local zoning assumptions.
- Building type.
- Roof type.
- Manual building-height enrichment.
- LiDAR or photogrammetry data.

## Recommendation

Start with:

```text
Leaflet click → MapLibre 3D modal → OSM building GeoJSON → fill-extrusion
```

Then upgrade to:

```text
CesiumJS + 3D Tiles
```

Use the CesiumJS path when you need richer 3D, terrain, LiDAR, photogrammetry, or very large geospatial scenes.

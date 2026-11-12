import type { GeoBBox } from './projection';
import { bboxFromCenter, padBBox } from './projection';

export function chunkBBoxHalf(lat: number, lon: number) {
  const b = bboxFromCenter(lat, lon);
  return { s: b.south, n: b.north, w: b.west, e: b.east };
}

/** Canonical Overpass QL for a playable chunk — pad so edge intersections keep geometry. */
export function buildOverpassQuery(lat: number, lon: number): string {
  return buildOverpassQueryFromBBox(padBBox(bboxFromCenter(lat, lon)));
}

export function buildOverpassQueryFromBBox(bbox: GeoBBox): string {
  const { south: s, north: n, west: w, east: e } = bbox;
  return `[out:json][timeout:25];(
  way["building"](${s},${w},${n},${e});
  way["highway"](${s},${w},${n},${e});
  way["railway"](${s},${w},${n},${e});
  way["waterway"](${s},${w},${n},${e});
  way["natural"="water"](${s},${w},${n},${e});
  way["landuse"](${s},${w},${n},${e});
  way["leisure"~"park|pitch|playground"](${s},${w},${n},${e});
  way["amenity"~"parking|fuel|school|place_of_worship|hospital|cafe|restaurant|university"](${s},${w},${n},${e});
  way["shop"](${s},${w},${n},${e});
  node["amenity"~"fuel|parking|school|place_of_worship|hospital|cafe|restaurant"](${s},${w},${n},${e});
  node["shop"](${s},${w},${n},${e});
  node["building"~"church|chapel|cathedral"](${s},${w},${n},${e});
  relation["building"](${s},${w},${n},${e});
  relation["amenity"~"school|place_of_worship|hospital|parking|university"](${s},${w},${n},${e});
  relation["type"="multipolygon"]["building"](${s},${w},${n},${e});
  relation["type"="multipolygon"]["natural"="water"](${s},${w},${n},${e});
  relation["type"="multipolygon"]["landuse"](${s},${w},${n},${e});
  relation["type"="multipolygon"]["leisure"](${s},${w},${n},${e});
  relation["type"="multipolygon"]["amenity"](${s},${w},${n},${e});
);out geom;`;
}

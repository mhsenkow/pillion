export interface GisRoad {
  name: string;
  points: [number, number][];
  halfWidth: number;
  primary: boolean;
}

export interface GisBuilding {
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  height: number;
  color: number;
  roofColor: number;
  steeple?: boolean;
  silo?: boolean;
  convenience?: boolean;
}

export const EMMETT_GIS = {
  banner: 'EMMETT, MI • M-19 (MAIN ST) & BRANDON RD',
  poiLabel: 'M-19 / CN RAILROAD',
  lat: 42.9906,
  lon: -82.7649,
  roads: [
    { name: 'Main St (M-19)', points: [[40, 0], [40, 159]] as [number, number][], halfWidth: 5.5, primary: true },
    { name: 'Brandon Rd (Co Rd)', points: [[0, 68], [79, 68]] as [number, number][], halfWidth: 4.0, primary: false },
    { name: 'Pine St', points: [[0, 24], [79, 24]] as [number, number][], halfWidth: 3.0, primary: false },
    { name: 'Prospect St', points: [[0, 102], [40, 102]] as [number, number][], halfWidth: 2.8, primary: false },
  ] as GisRoad[],
  railways: [{ name: 'CN / Grand Trunk Western RR', points: [[0, 118], [79, 126]] as [number, number][] }],
  buildings: [
    { name: 'Our Lady of Mt Carmel Church', x0: 10, z0: 32, x1: 26, z1: 52, height: 22, color: 0x9a3412, roofColor: 0x27272a, steeple: true },
    { name: 'Parish Hall & School', x0: 8, z0: 55, x1: 24, z1: 61, height: 10, color: 0x7c2d12, roofColor: 0x334155 },
    { name: 'Emmett Tavern & Grill', x0: 24, z0: 75, x1: 32, z1: 86, height: 11, color: 0x7c2d12, roofColor: 0x1e293b },
    { name: 'Historic Hardware & Feed', x0: 23, z0: 88, x1: 32, z1: 98, height: 12, color: 0x991b1b, roofColor: 0x27272a },
    { name: 'US Post Office — Emmett', x0: 25, z0: 105, x1: 32, z1: 113, height: 8, color: 0x64483a, roofColor: 0x475569 },
    { name: 'Emmett Village Hall & Fire', x0: 48, z0: 34, x1: 62, z1: 48, height: 11, color: 0x475569, roofColor: 0x991b1b },
    { name: 'Main St Market & Pharmacy', x0: 48, z0: 75, x1: 58, z1: 92, height: 10, color: 0x64483a, roofColor: 0x1e293b },
    { name: 'Sunset Corner Mart (7-style)', x0: 50, z0: 55, x1: 62, z1: 68, height: 9, color: 0x166534, roofColor: 0xf97316, convenience: true },
    { name: 'St. Clair Co Garage', x0: 49, z0: 95, x1: 64, z1: 108, height: 9, color: 0x52525b, roofColor: 0x3f3f46 },
    { name: 'Emmett Grain Elevator & Silos', x0: 10, z0: 126, x1: 28, z1: 148, height: 28, color: 0x64748b, roofColor: 0x475569, silo: true },
    { name: 'CN Railroad Freight Depot', x0: 49, z0: 129, x1: 68, z1: 142, height: 9, color: 0x52525b, roofColor: 0x27272a },
  ] as GisBuilding[],
};

export const LOCATION_PRESETS = [
  { lat: 42.9906, lon: -82.7649, name: 'Downtown Emmett, MI — M-19 & Brandon Rd', biome: 'EMMETT' },
  { lat: 42.8967, lon: -82.7688, name: 'Memphis, MI — M-19 & Black River Bridge', biome: 'MEMPHIS' },
  { lat: 42.4794, lon: -83.2452, name: 'Farmington Hills, MI — 12 Mile suburb', biome: 'URBAN' },
  { lat: 42.3314, lon: -83.0458, name: 'Detroit, MI — Woodward & Campus Martius', biome: 'URBAN' },
  { lat: 47.6101, lon: -122.3344, name: 'Seattle, WA — Pike St & 4th Ave', biome: 'URBAN' },
  { lat: 35.6595, lon: 139.7004, name: 'Tokyo — Shibuya Scramble', biome: 'DENSE' },
];

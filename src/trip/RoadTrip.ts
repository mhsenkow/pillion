import { fetchRoute, haversineMeters, type RoutePoint, type RouteResult } from './routing';

export const TRIP_STORAGE_KEY = 'pillion.trip.v1';

const METERS_PER_MILE = 1609.344;
const DEFAULT_AVG_MPH = 48;

export interface TripDestination {
  name: string;
  lat: number;
  lon: number;
}

export interface PathSample {
  lat: number;
  lon: number;
  at: number;
}

export interface TownArrivalCard {
  headline: string;
  subline: string;
  placeName: string;
  population?: number;
}

export interface PostcardData {
  kills: number;
  place: string;
  stamp: string;
  imageDataUrl?: string;
  milesOdometer: number;
  capturedAt: string;
}

export interface TripHudSnapshot {
  destinationName: string | null;
  distanceMiles: number | null;
  compassDeg: number | null;
  odometerMiles: number;
  etaMinutes: number | null;
  bearingLabel: string;
}

export interface NominatimPlaceHint {
  name?: string;
  display_name?: string;
  population?: string | number;
  type?: string;
  class?: string;
}

export interface TripSaveV1 {
  version: 1;
  destination: TripDestination | null;
  odometerMiles: number;
  path: PathSample[];
  postcards: PostcardData[];
  visitedTowns: string[];
  bikeLat: number;
  bikeLon: number;
  routeSource?: RouteResult['source'];
  routeDurationSeconds?: number;
  fastTravelMilesSaved: number;
}

function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function bearingLabel(deg: number): string {
  const idx = Math.round(deg / 45) % 8;
  return COMPASS[idx];
}

function formatPopulation(pop: number): string {
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 10_000) return `${Math.round(pop / 1000)}k`;
  return String(pop);
}

export interface FastTravelResult {
  /** Miles credited to the odometer after compression. */
  creditedMiles: number;
  /** Raw miles traveled in the real world. */
  realMiles: number;
  /** Miles skipped by fast-travel compression. */
  savedMiles: number;
}

/**
 * Highway fast-travel: credit only a fraction of real miles to the odometer between towns.
 * @param realMiles distance traveled on the stretch
 * @param compression divide real miles by this (default 4× compression)
 */
export function fastTravelStretch(realMiles: number, compression = 4): FastTravelResult {
  const safeCompression = Math.max(1, compression);
  const creditedMiles = realMiles / safeCompression;
  return {
    creditedMiles,
    realMiles,
    savedMiles: realMiles - creditedMiles,
  };
}

export class RoadTrip {
  private destination: TripDestination | null = null;
  private bikeLat = 0;
  private bikeLon = 0;
  private odometerMiles = 0;
  private path: PathSample[] = [];
  private postcards: PostcardData[] = [];
  private visitedTowns: string[] = [];
  private fastTravelMilesSaved = 0;
  private route: RouteResult | null = null;
  private routePromise: Promise<void> | null = null;
  private lastBikeSample: { lat: number; lon: number } | null = null;

  setDest(name: string, lat: number, lon: number): void {
    this.destination = { name: name.trim() || 'Destination', lat, lon };
    this.route = null;
    this.routePromise = this.refreshRoute();
  }

  clearDest(): void {
    this.destination = null;
    this.route = null;
    this.routePromise = null;
  }

  getDestination(): TripDestination | null {
    return this.destination;
  }

  setBikePosition(lat: number, lon: number, opts?: { fastTravel?: boolean; compression?: number }): void {
    if (this.lastBikeSample) {
      const deltaM = haversineMeters(this.lastBikeSample.lat, this.lastBikeSample.lon, lat, lon);
      let deltaMiles = deltaM / METERS_PER_MILE;
      if (opts?.fastTravel && deltaMiles > 0) {
        const ft = fastTravelStretch(deltaMiles, opts.compression);
        deltaMiles = ft.creditedMiles;
        this.fastTravelMilesSaved += ft.savedMiles;
      }
      if (deltaMiles > 0 && deltaMiles < 50) {
        this.odometerMiles += deltaMiles;
      }
    }
    this.bikeLat = lat;
    this.bikeLon = lon;
    this.lastBikeSample = { lat, lon };
    const now = Date.now();
    const last = this.path[this.path.length - 1];
    if (!last || haversineMeters(last.lat, last.lon, lat, lon) > 80) {
      this.path.push({ lat, lon, at: now });
      if (this.path.length > 4000) {
        this.path = this.path.slice(-3500);
      }
    }
  }

  async refreshRoute(): Promise<void> {
    if (!this.destination) return;
    const dest = this.destination;
    const res = await fetchRoute(this.bikeLat, this.bikeLon, dest.lat, dest.lon);
    this.route = res;
  }

  private ensureRoute(): Promise<void> | null {
    if (!this.destination) return null;
    if (this.route) return Promise.resolve();
    if (!this.routePromise) {
      this.routePromise = this.refreshRoute().finally(() => {
        this.routePromise = null;
      });
    }
    return this.routePromise;
  }

  distanceToDestinationMiles(): number | null {
    if (!this.destination) return null;
    if (this.route && this.route.distanceMeters > 0) {
      return this.route.distanceMeters / METERS_PER_MILE;
    }
    const m = haversineMeters(this.bikeLat, this.bikeLon, this.destination.lat, this.destination.lon);
    return m / METERS_PER_MILE;
  }

  compassBearingDeg(): number | null {
    if (!this.destination) return null;
    return bearingDegrees(this.bikeLat, this.bikeLon, this.destination.lat, this.destination.lon);
  }

  getOdometerMiles(): number {
    return this.odometerMiles;
  }

  etaMinutes(): number | null {
    const miles = this.distanceToDestinationMiles();
    if (miles === null) return null;
    if (this.route && this.route.durationSeconds > 0) {
      return Math.max(1, Math.round(this.route.durationSeconds / 60));
    }
    const hours = miles / DEFAULT_AVG_MPH;
    return Math.max(1, Math.round(hours * 60));
  }

  getHudSnapshot(): TripHudSnapshot {
    const compass = this.compassBearingDeg();
    return {
      destinationName: this.destination?.name ?? null,
      distanceMiles: this.distanceToDestinationMiles(),
      compassDeg: compass,
      odometerMiles: this.odometerMiles,
      etaMinutes: this.etaMinutes(),
      bearingLabel: compass !== null ? bearingLabel(compass) : '—',
    };
  }

  getRoutePolyline(): RoutePoint[] {
    if (this.route?.coordinates.length) return this.route.coordinates;
    if (this.destination) {
      return [
        { lat: this.bikeLat, lon: this.bikeLon },
        { lat: this.destination.lat, lon: this.destination.lon },
      ];
    }
    return this.path.map((p) => ({ lat: p.lat, lon: p.lon }));
  }

  getTraveledPath(): PathSample[] {
    return [...this.path];
  }

  buildTownArrivalCard(place: NominatimPlaceHint): TownArrivalCard {
    const rawName =
      place.name?.trim() ||
      place.display_name?.split(',')[0]?.trim() ||
      'Unknown town';
    const placeName = rawName.toUpperCase();
    let population: number | undefined;
    if (typeof place.population === 'number') {
      population = place.population;
    } else if (typeof place.population === 'string' && place.population.trim()) {
      const parsed = Number.parseInt(place.population.replace(/,/g, ''), 10);
      if (Number.isFinite(parsed)) population = parsed;
    }
    const popPart = population ? ` · POP ${formatPopulation(population)}` : '';
    const headline = `ENTERING ${placeName}`;
    const subline = `${place.type || place.class || 'town'}${popPart}`.toUpperCase();
    if (!this.visitedTowns.includes(placeName)) {
      this.visitedTowns.push(placeName);
    }
    return { headline, subline, placeName, population };
  }

  buildPostcard(kills: number, place: string, stamp: string, imageDataUrl?: string): PostcardData {
    const card: PostcardData = {
      kills,
      place: place.trim() || 'Somewhere',
      stamp: stamp.trim() || 'PILLION',
      imageDataUrl,
      milesOdometer: Math.round(this.odometerMiles * 10) / 10,
      capturedAt: new Date().toISOString(),
    };
    this.postcards.push(card);
    return card;
  }

  getPostcards(): PostcardData[] {
    return [...this.postcards];
  }

  toJSON(): TripSaveV1 {
    return {
      version: 1,
      destination: this.destination,
      odometerMiles: this.odometerMiles,
      path: this.path,
      postcards: this.postcards,
      visitedTowns: this.visitedTowns,
      bikeLat: this.bikeLat,
      bikeLon: this.bikeLon,
      routeSource: this.route?.source,
      routeDurationSeconds: this.route?.durationSeconds,
      fastTravelMilesSaved: this.fastTravelMilesSaved,
    };
  }

  load(data: TripSaveV1 | null): void {
    if (!data || data.version !== 1) return;
    this.destination = data.destination;
    this.odometerMiles = data.odometerMiles;
    this.path = data.path ?? [];
    this.postcards = data.postcards ?? [];
    this.visitedTowns = data.visitedTowns ?? [];
    this.bikeLat = data.bikeLat;
    this.bikeLon = data.bikeLon;
    this.fastTravelMilesSaved = data.fastTravelMilesSaved ?? 0;
    this.lastBikeSample = { lat: data.bikeLat, lon: data.bikeLon };
    this.route = null;
    if (this.destination) {
      this.routePromise = this.refreshRoute();
    }
  }

  save(): void {
    try {
      localStorage.setItem(TRIP_STORAGE_KEY, JSON.stringify(this.toJSON()));
    } catch {
      /* quota / private mode */
    }
  }

  static loadFromStorage(): RoadTrip {
    const trip = new RoadTrip();
    try {
      const raw = localStorage.getItem(TRIP_STORAGE_KEY);
      if (raw) {
        trip.load(JSON.parse(raw) as TripSaveV1);
      }
    } catch {
      /* corrupt save */
    }
    return trip;
  }

  async warmRoute(): Promise<void> {
    await this.ensureRoute();
  }
}
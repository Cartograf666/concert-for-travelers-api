// The published @types/node-geocoder package (and the package's own dist/index.js
// ESM build, which is NOT what "main" resolves to) describe a named `getGeocoder`
// export. The actual resolved CJS entry point (node_modules/node-geocoder/index.js,
// per its package.json "main") instead exports the geocoder factory itself as the
// default export -- i.e. `import getGeocoder from 'node-geocoder'` and call it
// directly with the options object (no adapter-name first argument). This is a
// minimal, locally-accurate shim for just the surface this project uses.
declare module 'node-geocoder' {
  export interface GeocodeEntry {
    formattedAddress?: string;
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
    countryCode?: string;
  }

  export interface Geocoder {
    geocode(query: string): Promise<GeocodeEntry[]>;
  }

  export interface OpenStreetMapOptions {
    provider: 'openstreetmap';
    // Nominatim's usage policy requires identifying automated clients.
    email?: string;
    osmServer?: string;
  }

  export default function getGeocoder(options: OpenStreetMapOptions | Record<string, unknown>): Geocoder;
}

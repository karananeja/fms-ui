/** A renderable position: finite, in range and not the (0, 0) "no fix" sentinel (gps-never). */
export const isValidPosition = (lat: number, lng: number): boolean =>
  lat === lat &&
  lng === lng &&
  !(lat === 0 && lng === 0) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

import type { Bbox } from '../worker/worker-api.ts';

export interface IndiaCity {
  name: string;
  state: string;
  bbox: Bbox;
}

/** Half-size of a city box; covers the mock generator's loops (≤ ~18 km from the centre). */
const HALF_KM = 22;
const KM_PER_DEG = 111.32;

const city = (name: string, state: string, lat: number, lng: number): IndiaCity => {
  const dLat = HALF_KM / KM_PER_DEG;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return { name, state, bbox: [r(lng - dLng), r(lat - dLat), r(lng + dLng), r(lat + dLat)] };
};

/** City dropdown (F06-R18): the 40 mock generator city centres, sorted A–Z. */
export const INDIA_CITIES: readonly IndiaCity[] = [
  city('Delhi', 'DL', 28.6139, 77.209),
  city('Noida', 'UP', 28.5355, 77.391),
  city('Chandigarh', 'CH', 30.7333, 76.7794),
  city('Mohali', 'PB', 30.7046, 76.7179),
  city('Jaipur', 'RJ', 26.9124, 75.7873),
  city('Ajmer', 'RJ', 26.4499, 74.6399),
  city('Lucknow', 'UP', 26.8467, 80.9462),
  city('Kanpur', 'UP', 26.4499, 80.3319),
  city('Dehradun', 'UK', 30.3165, 78.0322),
  city('Haridwar', 'UK', 29.9457, 78.1642),
  city('Bengaluru', 'KA', 12.9716, 77.5946),
  city('Mysuru', 'KA', 12.2958, 76.6394),
  city('Chennai', 'TN', 13.0827, 80.2707),
  city('Vellore', 'TN', 12.9165, 79.1325),
  city('Hyderabad', 'TS', 17.385, 78.4867),
  city('Warangal', 'TS', 17.9689, 79.5941),
  city('Kochi', 'KL', 9.9312, 76.2673),
  city('Thiruvananthapuram', 'KL', 8.5241, 76.9366),
  city('Coimbatore', 'TN', 11.0168, 76.9558),
  city('Madurai', 'TN', 9.9252, 78.1198),
  city('Kolkata', 'WB', 22.5726, 88.3639),
  city('Howrah', 'WB', 22.5958, 88.2636),
  city('Bhubaneswar', 'OD', 20.2961, 85.8245),
  city('Cuttack', 'OD', 20.4625, 85.883),
  city('Patna', 'BR', 25.5941, 85.1376),
  city('Gaya', 'BR', 24.7914, 85.0002),
  city('Guwahati', 'AS', 26.1445, 91.7362),
  city('Shillong', 'ML', 25.5788, 91.8933),
  city('Ranchi', 'JH', 23.3441, 85.3096),
  city('Jamshedpur', 'JH', 22.8046, 86.2029),
  city('Mumbai', 'MH', 19.076, 72.8777),
  city('Thane', 'MH', 19.2183, 72.9781),
  city('Pune', 'MH', 18.5204, 73.8567),
  city('Nashik', 'MH', 19.9975, 73.7898),
  city('Ahmedabad', 'GJ', 23.0225, 72.5714),
  city('Vadodara', 'GJ', 22.3072, 73.1812),
  city('Surat', 'GJ', 21.1702, 72.8311),
  city('Rajkot', 'GJ', 22.3039, 70.8022),
  city('Indore', 'MP', 22.7196, 75.8577),
  city('Bhopal', 'MP', 23.2599, 77.4126),
].sort((a, b) => a.name.localeCompare(b.name));

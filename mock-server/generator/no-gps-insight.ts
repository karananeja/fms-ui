import {
  NO_GPS_SIGNAL_THRESHOLDS,
  type BreakdownReason,
  type LikelyCause,
  type NoGpsInsight,
} from '@shared/contract/index.ts';
import { NO_GPS_MS, NON_COMM_MS, type VehicleSim } from './vehicle-sim.ts';

type Signals = NoGpsInsight['signals'];

const EXPLANATIONS: Record<LikelyCause, string> = {
  'driver-reported': 'The driver reported a faulty GPS device on an open breakdown request.',
  'device-offline':
    'The device has stopped reporting altogether, so the GPS loss is part of a wider outage.',
  'device-battery-low':
    'The tracking device battery is below 3.4 V, which is usually too low to keep a GPS fix.',
  'weak-signal':
    'The device signal is weaker than -105 dBm, so the vehicle is probably somewhere with poor coverage.',
  'ignition-off':
    'The ignition is off, so the vehicle is probably parked somewhere without sky view, such as indoors.',
  unknown: 'The device is powered and connected but has no GPS fix; the antenna may need checking.',
};

/** F11 §2 priority order: first match wins. */
export function likelyCause(signals: Signals, reportedReason?: BreakdownReason): LikelyCause {
  if (reportedReason === 'no-gps-device') return 'driver-reported';
  if (signals.deviceOffline) return 'device-offline';
  if (signals.devBatteryLow) return 'device-battery-low';
  if (signals.weakSignal) return 'weak-signal';
  if (signals.ignitionOff) return 'ignition-off';
  return 'unknown';
}

/**
 * Insight for a vehicle that has had GPS before and lost it for more than the F05 no-GPS
 * threshold (non-comm vehicles included, as `deviceOffline`); `null` otherwise.
 */
export function noGpsInsight(
  sim: VehicleSim,
  i: number,
  now: number,
  reportedReason?: BreakdownReason,
): NoGpsInsight | null {
  const s = sim.state(i, now);
  if (s.gpstime <= 0 || (s.lat === 0 && s.lng === 0) || now - s.gpstime <= NO_GPS_MS) return null;
  const signals: Signals = {
    devBatteryLow: s.devbattery < NO_GPS_SIGNAL_THRESHOLDS.devBatteryLowVolts,
    weakSignal: s.rxdbm < NO_GPS_SIGNAL_THRESHOLDS.weakSignalDbm,
    ignitionOff: s.ignstatus === 0,
    deviceOffline: now - s.utctime > NON_COMM_MS,
  };
  const cause = likelyCause(signals, reportedReason);
  return {
    vehicleId: sim.vehicleId(i),
    since: s.gpstime,
    durationMs: now - s.gpstime,
    ...(reportedReason ? { reportedReason } : {}),
    signals,
    likelyCause: cause,
    explanation: EXPLANATIONS[cause],
  };
}

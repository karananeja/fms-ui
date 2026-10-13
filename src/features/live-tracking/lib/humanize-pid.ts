const ACRONYMS = new Set(
  'SOC SOH DTE BMS MCU VCU MVCU ODO ECU ID BLE CAN GSM IMU AFE OCV LED DC AC UDS EOL TFT ADC PWM FOC TCU VIN'.split(
    ' ',
  ),
);

const cache = new Map<string, string>();

function word(w: string): string {
  const up = w.toUpperCase();
  if (ACRONYMS.has(up) || /^\d/.test(w)) return up;
  return w[0]!.toUpperCase() + w.slice(1);
}

/** `motor_temperature` → "Motor Temperature"; `_12v_count` → "12V Count"; `bms_status` → "BMS Status". */
export function humanizePid(key: string): string {
  let label = cache.get(key);
  if (label === undefined) {
    label = key.replace(/^_+/, '').split('_').filter(Boolean).map(word).join(' ');
    cache.set(key, label);
  }
  return label;
}

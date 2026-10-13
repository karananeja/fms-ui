import { describe, expect, it } from 'vitest';
import { humanizePid } from './humanize-pid.ts';

describe('F07-T1: humanizePid', () => {
  it.each([
    ['motor_temperature', 'Motor Temperature'],
    ['cell_voltage_01', 'Cell Voltage 01'],
    ['_12v_count', '12V Count'],
    ['5v_fault', '5V Fault'],
    ['__leading', 'Leading'],
    ['soc', 'SOC'],
    ['soh', 'SOH'],
    ['bms_chargingcycles', 'BMS Chargingcycles'],
    ['mvcu_eol_check_tft', 'MVCU EOL Check TFT'],
    ['mcu_uds_req_byte_00', 'MCU UDS Req Byte 00'],
    ['ble_status', 'BLE Status'],
    ['can_bus_fault', 'CAN Bus Fault'],
    ['dc_dc_relay_12v', 'DC DC Relay 12V'],
    ['vin_matching_status', 'VIN Matching Status'],
    ['ecuid_part1', 'Ecuid Part1'],
    ['homologation_id', 'Homologation ID'],
    ['imu_fault', 'IMU Fault'],
    ['afe_error', 'AFE Error'],
    ['ocv_cell', 'OCV Cell'],
    ['odo_sync_status', 'ODO Sync Status'],
    ['charging_led_status', 'Charging LED Status'],
    ['mcu_pwm_bypass_on_dc_oc', 'MCU PWM Bypass On DC Oc'],
    ['mcu_focalgorithm_fault', 'MCU Focalgorithm Fault'],
    ['gsm_fault', 'GSM Fault'],
    ['dte', 'DTE'],
  ])('%s → %s', (key, label) => {
    expect(humanizePid(key)).toBe(label);
  });
});

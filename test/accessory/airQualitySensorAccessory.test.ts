/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import * as hap from '@homebridge/hap-nodejs';
import AirQualitySensorAccessory from '../../src/accessory/AirQualitySensorAccessory';
import {
  AIR_QUALITY_LEVEL_UUID,
  FORMALDEHYDE_DENSITY_UUID,
  PM1_DENSITY_UUID,
} from '../../src/accessory/characteristic/CustomAirQuality';
import TuyaDevice, { TuyaDeviceSchemaMode, TuyaDeviceSchemaType } from '../../src/device/TuyaDevice';
import { initLogger } from '../../src/util/Logger';

const { Service, Characteristic } = hap;

const intSchema = (code: string, unit: string, scale = 0, max = 9999) => ({
  code,
  mode: TuyaDeviceSchemaMode.READ_ONLY,
  type: TuyaDeviceSchemaType.Integer,
  property: { unit, min: 0, max, scale, step: 1 },
});
const enumSchema = (code: string, range: string[], mode = TuyaDeviceSchemaMode.READ_ONLY) => ({
  code, mode, type: TuyaDeviceSchemaType.Enum, property: { range },
});
const boolSchema = (code: string) => ({
  code, mode: TuyaDeviceSchemaMode.READ_ONLY, type: TuyaDeviceSchemaType.Boolean, property: {},
});

// Real schema reported by a ZN-MT29 "15-in-1" air quality monitor (category hjjcy).
const MT29_SCHEMA = [
  enumSchema('air_quality_index', ['level_1', 'level_2', 'level_3']),
  enumSchema('alarm_volume', ['low', 'middle', 'high', 'mute'], TuyaDeviceSchemaMode.READ_WRITE),
  intSchema('battery_percentage', '%', 0, 100),
  intSchema('ch2o_value', 'mg/m³', 3),
  boolSchema('charge_state'),
  intSchema('co2_value', 'ppm', 0, 10000),
  intSchema('humidity_value', '%', 0, 1000),
  intSchema('pm1', 'ug/m³', 0, 999),
  intSchema('pm10', 'ug/m³', 0, 999),
  intSchema('pm25_value', 'ug/m³', 0, 999),
  intSchema('temp_current', '℃', 0),
];
const MT29_STATUS = {
  air_quality_index: 'level_1', alarm_volume: 'middle', battery_percentage: 100, ch2o_value: 27,
  charge_state: true, co2_value: 505, humidity_value: 61, pm1: 15, pm10: 21, pm25_value: 15, temp_current: 22,
};

describe('AirQualitySensorAccessory', () => {
  let device: TuyaDevice;
  let platformAccessory: any;
  let platform: any;

  beforeEach(() => {
    const noop = () => undefined;
    platform = {
      api: { hap },
      options: { debug: false },
      deviceManager: { getDevice: jest.fn(() => device), sendCommands: jest.fn() },
      getDeviceConfig: jest.fn(() => undefined),
      getDeviceSchemaConfig: jest.fn(() => undefined),
      log: { info: noop, warn: noop, error: noop, debug: noop },
    };
    initLogger(platform.log);
  });

  const setup = (schema: any[], status: Record<string, unknown>) => {
    device = new TuyaDevice({
      id: 'aq-device', uuid: 'aq-uuid', name: 'Living Room Air', online: true, owner_id: 'owner',
      product_id: 'owmkja70doamcxkh', product_name: 'MT15/MT29', category: 'hjjcy', sub: false,
      schema, status: Object.entries(status).map(([code, value]) => ({ code, value })),
    } as any);
    platformAccessory = new hap.Accessory('Living Room Air', hap.uuid.generate('aq-uuid'));
    platformAccessory.context = { deviceID: 'aq-device' };
    const accessory = new AirQualitySensorAccessory(platform, platformAccessory);
    expect(accessory.checkRequirements()).toBe(true);
    accessory.configureServices();
    return accessory;
  };

  const service = (type: any) => platformAccessory.getService(type);
  const read = async (serviceType: any, characteristic: any) => {
    const svc = service(serviceType);
    expect(svc).toBeDefined();
    const char = typeof characteristic === 'string'
      ? svc.characteristics.find((c: any) => c.UUID === characteristic)
      : svc.getCharacteristic(characteristic);
    expect(char).toBeDefined();
    return char.handleGetRequest();
  };
  const setStatus = (code: string, value: unknown) => {
    device.status.find(s => s.code === code)!.value = value as any;
  };

  test('ZN-MT29 exposes every measurement', async () => {
    setup(MT29_SCHEMA, MT29_STATUS);

    expect(await read(Service.AirQualitySensor, Characteristic.AirQuality)).toBe(Characteristic.AirQuality.GOOD);
    expect(await read(Service.AirQualitySensor, Characteristic.PM2_5Density)).toBe(15);
    expect(await read(Service.AirQualitySensor, Characteristic.PM10Density)).toBe(21);
    // No voc_value: formaldehyde stands in for VOC, converted mg/m³ -> µg/m³.
    expect(await read(Service.AirQualitySensor, Characteristic.VOCDensity)).toBe(27);
    expect(await read(Service.AirQualitySensor, PM1_DENSITY_UUID)).toBe(15);
    expect(await read(Service.AirQualitySensor, FORMALDEHYDE_DENSITY_UUID)).toBe(27);
    expect(await read(Service.AirQualitySensor, AIR_QUALITY_LEVEL_UUID)).toBe(1);

    expect(await read(Service.CarbonDioxideSensor, Characteristic.CarbonDioxideLevel)).toBe(505);
    expect(await read(Service.CarbonDioxideSensor, Characteristic.CarbonDioxideDetected))
      .toBe(Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL);
    expect(await read(Service.TemperatureSensor, Characteristic.CurrentTemperature)).toBe(22);
    expect(await read(Service.HumiditySensor, Characteristic.CurrentRelativeHumidity)).toBe(61);
    expect(await read(Service.Battery, Characteristic.BatteryLevel)).toBe(100);

    setStatus('co2_value', 1450);
    expect(await read(Service.CarbonDioxideSensor, Characteristic.CarbonDioxideDetected))
      .toBe(Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL);
  });

  test('real voc_value wins over formaldehyde for VOCDensity', async () => {
    setup([intSchema('pm25_value', 'ug/m³'), intSchema('voc_value', 'ug/m³'), intSchema('ch2o_value', 'mg/m³', 3)],
      { pm25_value: 5, voc_value: 120, ch2o_value: 40 });

    expect(await read(Service.AirQualitySensor, Characteristic.VOCDensity)).toBe(120);
    expect(await read(Service.AirQualitySensor, FORMALDEHYDE_DENSITY_UUID)).toBe(40);
  });

  test('device air quality index drives the rating when there is no PM2.5', async () => {
    const range = ['level_1', 'level_2', 'level_3', 'level_4', 'level_5', 'level_6'];
    setup([enumSchema('air_quality_index', range), intSchema('co2_value', 'ppm')],
      { air_quality_index: 'level_1', co2_value: 600 });

    const { EXCELLENT, FAIR, POOR } = Characteristic.AirQuality;
    expect(await read(Service.AirQualitySensor, Characteristic.AirQuality)).toBe(EXCELLENT);
    setStatus('air_quality_index', 'level_3');
    expect(await read(Service.AirQualitySensor, Characteristic.AirQuality)).toBe(FAIR);
    setStatus('air_quality_index', 'level_6');
    expect(await read(Service.AirQualitySensor, Characteristic.AirQuality)).toBe(POOR);
    expect(await read(Service.AirQualitySensor, AIR_QUALITY_LEVEL_UUID)).toBe(6);
  });

  test('three-level index spreads over the HomeKit scale', async () => {
    setup([enumSchema('air_quality_index', ['level_1', 'level_2', 'level_3'])], { air_quality_index: 'level_2' });
    expect(await read(Service.AirQualitySensor, Characteristic.AirQuality)).toBe(Characteristic.AirQuality.FAIR);
    setStatus('air_quality_index', 'level_3');
    expect(await read(Service.AirQualitySensor, Characteristic.AirQuality)).toBe(Characteristic.AirQuality.POOR);
  });

  test('CO2-only detector loads without an AirQualitySensor service', async () => {
    setup([intSchema('co2_value', 'ppm'), intSchema('temp_current', '℃', 1)], { co2_value: 800, temp_current: 215 });

    expect(service(Service.AirQualitySensor)).toBeUndefined();
    expect(await read(Service.CarbonDioxideSensor, Characteristic.CarbonDioxideLevel)).toBe(800);
    expect(await read(Service.TemperatureSensor, Characteristic.CurrentTemperature)).toBe(21.5);
  });

  test('tamper, fault and end-of-life flags reach every sensor service', async () => {
    setup([
      intSchema('pm25_value', 'ug/m³'), intSchema('co2_value', 'ppm'),
      boolSchema('tamper_alarm'), boolSchema('lifecycle'),
      { code: 'fault', mode: TuyaDeviceSchemaMode.READ_ONLY, type: 'Bitmap' as any, property: { label: ['fault'] } },
    ], { pm25_value: 5, co2_value: 500, tamper_alarm: false, lifecycle: false, fault: 0 });

    const { NO_FAULT, GENERAL_FAULT } = Characteristic.StatusFault;
    const { NOT_TAMPERED, TAMPERED } = Characteristic.StatusTampered;
    for (const type of [Service.AirQualitySensor, Service.CarbonDioxideSensor]) {
      expect(await read(type, Characteristic.StatusFault)).toBe(NO_FAULT);
      expect(await read(type, Characteristic.StatusTampered)).toBe(NOT_TAMPERED);
    }

    setStatus('tamper_alarm', true);
    setStatus('fault', 4);
    expect(await read(Service.CarbonDioxideSensor, Characteristic.StatusTampered)).toBe(TAMPERED);
    expect(await read(Service.AirQualitySensor, Characteristic.StatusFault)).toBe(GENERAL_FAULT);

    setStatus('fault', 0);
    setStatus('lifecycle', true);
    expect(await read(Service.AirQualitySensor, Characteristic.StatusFault)).toBe(GENERAL_FAULT);
  });
});

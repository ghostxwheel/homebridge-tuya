/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import * as hap from '@homebridge/hap-nodejs';
import AirQualitySensorAccessory from '../../src/accessory/AirQualitySensorAccessory';
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
  charge_state: true, co2_value: 505, humidity_value: 61, pm1: 9, pm10: 21, pm25_value: 15, temp_current: 22,
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

  const createDevice = (schema: any[], status: Record<string, unknown>) => {
    device = new TuyaDevice({
      id: 'aq-device', uuid: 'aq-uuid', name: 'Living Room Air', online: true, owner_id: 'owner',
      product_id: 'owmkja70doamcxkh', product_name: 'MT15/MT29', category: 'hjjcy', sub: false,
      schema, status: Object.entries(status).map(([code, value]) => ({ code, value })),
    } as any);
  };
  const configure = () => {
    const accessory = new AirQualitySensorAccessory(platform, platformAccessory);
    expect(accessory.checkRequirements()).toBe(true);
    accessory.configureServices();
    return accessory;
  };
  const setup = (schema: any[], status: Record<string, unknown>) => {
    createDevice(schema, status);
    platformAccessory = new hap.Accessory('Living Room Air', hap.uuid.generate('aq-uuid'));
    platformAccessory.context = { deviceID: 'aq-device' };
    return configure();
  };

  const airQualityServices = () =>
    platformAccessory.services.filter((s: any) => s.UUID === Service.AirQualitySensor.UUID);
  const mainService = () => airQualityServices().find((s: any) => !s.subtype);
  const extraService = (subtype: string) => platformAccessory.getServiceById(Service.AirQualitySensor, subtype);
  const read = (svc: any, characteristic: any) => {
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(characteristic)).toBe(true);
    return svc.getCharacteristic(characteristic).handleGetRequest();
  };
  const setStatus = (code: string, value: unknown) => {
    device.status.find(s => s.code === code)!.value = value as any;
  };

  test('ZN-MT29 gets one sensor per measurement on a single accessory', async () => {
    setup(MT29_SCHEMA, MT29_STATUS);
    const { EXCELLENT, GOOD } = Characteristic.AirQuality;

    // Main sensor stays as upstream: rating + PM2.5 + PM10, no VOC (device has none).
    expect(await read(mainService(), Characteristic.AirQuality)).toBe(GOOD);
    expect(await read(mainService(), Characteristic.PM2_5Density)).toBe(15);
    expect(await read(mainService(), Characteristic.PM10Density)).toBe(21);
    expect(mainService().testCharacteristic(Characteristic.VOCDensity)).toBe(false);

    const pm1 = extraService('pm1');
    expect(pm1.getCharacteristic(Characteristic.ConfiguredName).value).toBe('Living Room Air PM1');
    expect(await read(pm1, Characteristic.PM2_5Density)).toBe(9);
    expect(await read(pm1, Characteristic.AirQuality)).toBe(EXCELLENT);

    const ch2o = extraService('ch2o');
    expect(ch2o.getCharacteristic(Characteristic.ConfiguredName).value).toBe('Living Room Air Formaldehyde');
    expect(await read(ch2o, Characteristic.VOCDensity)).toBe(27); // 0.027 mg/m³
    expect(await read(ch2o, Characteristic.AirQuality)).toBe(EXCELLENT);

    const aqi = extraService('air_quality_index');
    expect(aqi.getCharacteristic(Characteristic.ConfiguredName).value).toBe('Living Room Air AQI');
    expect(await read(aqi, Characteristic.AirQuality)).toBe(EXCELLENT);

    expect(airQualityServices()).toHaveLength(4);
    const co2 = platformAccessory.getService(Service.CarbonDioxideSensor);
    expect(await read(co2, Characteristic.CarbonDioxideLevel)).toBe(505);
    expect(await read(co2, Characteristic.CarbonDioxideDetected)).toBe(Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL);
    expect(await read(platformAccessory.getService(Service.TemperatureSensor), Characteristic.CurrentTemperature)).toBe(22);
    expect(await read(platformAccessory.getService(Service.HumiditySensor), Characteristic.CurrentRelativeHumidity)).toBe(61);
    expect(await read(platformAccessory.getService(Service.Battery), Characteristic.BatteryLevel)).toBe(100);

    setStatus('co2_value', 1450);
    setStatus('ch2o_value', 150);
    setStatus('air_quality_index', 'level_3');
    expect(await read(co2, Characteristic.CarbonDioxideDetected)).toBe(Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL);
    expect(await read(ch2o, Characteristic.AirQuality)).toBe(Characteristic.AirQuality.INFERIOR);
    expect(await read(aqi, Characteristic.AirQuality)).toBe(Characteristic.AirQuality.POOR);
  });

  test('reconfiguring a cached accessory keeps the same services', () => {
    setup(MT29_SCHEMA, MT29_STATUS);
    const before = platformAccessory.services.map((s: any) => `${s.UUID}/${s.subtype}`).sort();
    configure();
    expect(platformAccessory.services.map((s: any) => `${s.UUID}/${s.subtype}`).sort()).toEqual(before);
  });

  test('cached legacy characteristics are removed from the main sensor', () => {
    createDevice(MT29_SCHEMA, MT29_STATUS);
    platformAccessory = new hap.Accessory('Living Room Air', hap.uuid.generate('aq-uuid'));
    platformAccessory.context = { deviceID: 'aq-device' };
    const cached = platformAccessory.addService(Service.AirQualitySensor);
    cached.addCharacteristic(Characteristic.VOCDensity);
    cached.addCharacteristic(new hap.Characteristic('PM1 Density', '5A15DE85-A43B-5E00-AA4E-055A507F3B0C',
      { format: hap.Formats.FLOAT, perms: [hap.Perms.PAIRED_READ] }));

    configure();
    expect(mainService()).toBe(cached);
    expect(cached.testCharacteristic(Characteristic.VOCDensity)).toBe(false);
    expect(cached.characteristics.some((c: any) => c.UUID === '5A15DE85-A43B-5E00-AA4E-055A507F3B0C')).toBe(false);
  });

  test('real voc_value stays on the main sensor next to a formaldehyde sensor', async () => {
    setup([intSchema('pm25_value', 'ug/m³'), intSchema('voc_value', 'ug/m³'), intSchema('ch2o_value', 'mg/m³', 3)],
      { pm25_value: 5, voc_value: 120, ch2o_value: 40 });

    expect(await read(mainService(), Characteristic.VOCDensity)).toBe(120);
    expect(await read(extraService('ch2o'), Characteristic.VOCDensity)).toBe(40);
    expect(extraService('pm1')).toBeUndefined();
  });

  test('device air quality index rates the main sensor when there is no PM2.5', async () => {
    const range = ['level_1', 'level_2', 'level_3', 'level_4', 'level_5', 'level_6'];
    setup([enumSchema('air_quality_index', range), intSchema('pm10', 'ug/m³')], { air_quality_index: 'level_1', pm10: 30 });

    const { EXCELLENT, FAIR, POOR } = Characteristic.AirQuality;
    expect(await read(mainService(), Characteristic.AirQuality)).toBe(EXCELLENT);
    setStatus('air_quality_index', 'level_3');
    expect(await read(mainService(), Characteristic.AirQuality)).toBe(FAIR);
    setStatus('air_quality_index', 'level_6');
    expect(await read(extraService('air_quality_index'), Characteristic.AirQuality)).toBe(POOR);
  });

  test('CO2-only detector loads without any AirQualitySensor service', async () => {
    setup([intSchema('co2_value', 'ppm'), intSchema('temp_current', '℃', 1)], { co2_value: 800, temp_current: 215 });

    expect(airQualityServices()).toHaveLength(0);
    expect(await read(platformAccessory.getService(Service.CarbonDioxideSensor), Characteristic.CarbonDioxideLevel)).toBe(800);
    expect(await read(platformAccessory.getService(Service.TemperatureSensor), Characteristic.CurrentTemperature)).toBe(21.5);
  });

  test('tamper, fault and end-of-life flags reach every sensor service', async () => {
    setup([
      intSchema('pm25_value', 'ug/m³'), intSchema('pm1', 'ug/m³'), intSchema('co2_value', 'ppm'),
      boolSchema('tamper_alarm'), boolSchema('lifecycle'),
      { code: 'fault', mode: TuyaDeviceSchemaMode.READ_ONLY, type: 'Bitmap' as any, property: { label: ['fault'] } },
    ], { pm25_value: 5, pm1: 3, co2_value: 500, tamper_alarm: false, lifecycle: false, fault: 0 });

    const { NO_FAULT, GENERAL_FAULT } = Characteristic.StatusFault;
    const { NOT_TAMPERED, TAMPERED } = Characteristic.StatusTampered;
    const sensors = [mainService(), extraService('pm1'), platformAccessory.getService(Service.CarbonDioxideSensor)];
    for (const svc of sensors) {
      expect(await read(svc, Characteristic.StatusFault)).toBe(NO_FAULT);
      expect(await read(svc, Characteristic.StatusTampered)).toBe(NOT_TAMPERED);
    }

    setStatus('tamper_alarm', true);
    setStatus('fault', 4);
    expect(await read(extraService('pm1'), Characteristic.StatusTampered)).toBe(TAMPERED);
    expect(await read(mainService(), Characteristic.StatusFault)).toBe(GENERAL_FAULT);

    setStatus('fault', 0);
    setStatus('lifecycle', true);
    expect(await read(platformAccessory.getService(Service.CarbonDioxideSensor), Characteristic.StatusFault)).toBe(GENERAL_FAULT);
  });
});

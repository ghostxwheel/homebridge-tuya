import { Service } from 'homebridge';
import { TuyaDeviceSchema, TuyaDeviceSchemaIntegerProperty, TuyaDeviceSchemaType } from '../../device/TuyaDevice';
import BaseAccessory from '../BaseAccessory';
import { limit } from '../../util/util';

export function configureAirQuality(
  accessory: BaseAccessory,
  service?: Service,
  airQualitySchema?: TuyaDeviceSchema,
  pm2_5Schema?: TuyaDeviceSchema,
  pm10Schema?: TuyaDeviceSchema,
  vocSchema?: TuyaDeviceSchema,
) {
  if (!airQualitySchema) {
    return;
  }

  if (!service) {
    service = accessory.accessory.getService(accessory.Service.AirQualitySensor)
      || accessory.accessory.addService(accessory.Service.AirQualitySensor);
  }

  pm2_5Schema && configureDensity(accessory, service, accessory.Characteristic.PM2_5Density, pm2_5Schema);
  pm10Schema && configureDensity(accessory, service, accessory.Characteristic.PM10Density, pm10Schema);
  vocSchema && configureDensity(accessory, service, accessory.Characteristic.VOCDensity, vocSchema);

  const property = airQualitySchema.property as TuyaDeviceSchemaIntegerProperty;
  const multiple = Math.pow(10, property ? property.scale : 0);
  const { UNKNOWN, EXCELLENT, GOOD, FAIR, INFERIOR, POOR } = accessory.Characteristic.AirQuality;
  service.getCharacteristic(accessory.Characteristic.AirQuality)
    .onGet(() => {
      const status = accessory.getStatus(airQualitySchema.code)!;
      if (airQualitySchema.type === TuyaDeviceSchemaType.Integer) {
        const value = limit(status.value as number / multiple, 0, 1000);
        if (value <= 10) {
          return EXCELLENT;
        } else if (value <= 50) {
          return GOOD;
        } else if (value <= 100) {
          return FAIR;
        } else if (value <= 200) {
          return INFERIOR;
        } else {
          return POOR;
        }
      } else if (airQualitySchema.type === TuyaDeviceSchemaType.Enum) {
        if (status.value === 'great') {
          return EXCELLENT;
        } else if (status.value === 'good') {
          return GOOD;
        } else if (status.value === 'mild') {
          return FAIR;
        } else if (status.value === 'medium') {
          return INFERIOR;
        } else if (status.value === 'severe') {
          return POOR;
        }

        // Environmental detectors (hjjcy) report `level_1` (best) .. `level_N` (worst).
        // Spread the device's own scale over HomeKit's five levels.
        const level = parseAirQualityLevel(status.value);
        if (level !== undefined) {
          const range = (airQualitySchema.property as { range?: string[] })?.range ?? [];
          const levels = range.map(parseAirQualityLevel).filter((l): l is number => l !== undefined);
          const maxLevel = levels.length > 1 ? Math.max(...levels) : 6;
          const ratio = limit((level - 1) / (maxLevel - 1), 0, 1);
          return [EXCELLENT, GOOD, FAIR, INFERIOR, POOR][Math.round(ratio * 4)];
        }
      }

      return UNKNOWN;
    });
}

export function parseAirQualityLevel(value: unknown): number | undefined {
  const match = /^level_(\d+)$/.exec(String(value));
  return match ? Number(match[1]) : undefined;
}

/**
 * Returns a getter for a density DP in µg/m³ (the unit HomeKit uses).
 * Some devices (e.g. `ch2o_value`) report mg/m³, which is converted.
 */
export function createDensityGetter(accessory: BaseAccessory, schema: TuyaDeviceSchema, max = 1000): () => number {
  const property = schema.property as TuyaDeviceSchemaIntegerProperty;
  const multiple = Math.pow(10, property ? property.scale : 0);
  const unitFactor = (property && property.unit && property.unit.toLowerCase().startsWith('mg')) ? 1000 : 1;
  return () => {
    const status = accessory.getStatus(schema.code);
    const value = Number(status?.value) / multiple * unitFactor;
    return limit(isNaN(value) ? 0 : value, 0, max);
  };
}

function configureDensity(
  accessory: BaseAccessory,
  service: Service,
  characteristic,
  schema?: TuyaDeviceSchema,
) {
  if (!schema) {
    return;
  }

  service.getCharacteristic(characteristic)
    .onGet(createDensityGetter(accessory, schema));
}

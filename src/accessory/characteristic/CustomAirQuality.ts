import { API, Service } from 'homebridge';
import { TuyaDeviceSchema } from '../../device/TuyaDevice';
import BaseAccessory from '../BaseAccessory';
import { createDensityGetter, parseAirQualityLevel } from './AirQuality';

// Measurements HomeKit has no standard characteristic for. Apple Home ignores custom
// characteristics; Eve, Controller for HomeKit and the Homebridge UI/API show them.
// UUIDs are uuid5(NAMESPACE_URL, 'homebridge-tuya/<Name>') and must never change.
export const PM1_DENSITY_UUID = '5A15DE85-A43B-5E00-AA4E-055A507F3B0C';
export const FORMALDEHYDE_DENSITY_UUID = '882A6799-0E15-5B85-8AFC-8BD2AEB8BF53';
export const AIR_QUALITY_LEVEL_UUID = '3F7E7310-EA92-5E79-9D23-2431D4BBA54B';

// Characteristic classes must be created once per HAP instance, or HAP sees duplicates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new WeakMap<API, Record<string, any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCustomCharacteristics(api: API): Record<string, any> {
  let classes = cache.get(api);
  if (classes) {
    return classes;
  }

  const { Characteristic, Formats, Perms } = api.hap;
  const density = (name: string, uuid: string, maxValue: number) => class extends Characteristic {
    static readonly UUID = uuid;
    constructor() {
      super(name, uuid, {
        format: Formats.FLOAT,
        perms: [Perms.NOTIFY, Perms.PAIRED_READ],
        unit: 'µg/m³',
        minValue: 0,
        maxValue,
        minStep: 0.1,
      });
      this.value = this.getDefaultValue();
    }
  };

  classes = {
    PM1Density: density('PM1 Density', PM1_DENSITY_UUID, 1000),
    FormaldehydeDensity: density('Formaldehyde Density', FORMALDEHYDE_DENSITY_UUID, 10000),
    AirQualityLevel: class extends Characteristic {
      static readonly UUID = AIR_QUALITY_LEVEL_UUID;
      constructor() {
        super('Air Quality Level', AIR_QUALITY_LEVEL_UUID, {
          format: Formats.UINT8,
          perms: [Perms.NOTIFY, Perms.PAIRED_READ],
          minValue: 0,
          maxValue: 10,
          minStep: 1,
        });
        this.value = this.getDefaultValue();
      }
    },
  };
  cache.set(api, classes);
  return classes;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attach(service: Service, characteristic: any, getter: () => number) {
  if (!service.testCharacteristic(characteristic)) {
    service.addCharacteristic(characteristic);
  }
  service.getCharacteristic(characteristic).onGet(getter);
}

export function configureCustomAirQuality(
  accessory: BaseAccessory,
  service: Service,
  pm1Schema?: TuyaDeviceSchema,
  ch2oSchema?: TuyaDeviceSchema,
  airQualityIndexSchema?: TuyaDeviceSchema,
) {
  const classes = getCustomCharacteristics(accessory.platform.api);

  if (pm1Schema) {
    attach(service, classes.PM1Density, createDensityGetter(accessory, pm1Schema));
  }

  if (ch2oSchema) {
    attach(service, classes.FormaldehydeDensity, createDensityGetter(accessory, ch2oSchema, 10000));
  }

  if (airQualityIndexSchema) {
    attach(service, classes.AirQualityLevel, () => {
      const status = accessory.getStatus(airQualityIndexSchema.code);
      const level = parseAirQualityLevel(status?.value) ?? Number(status?.value);
      return isNaN(level) ? 0 : level;
    });
  }
}

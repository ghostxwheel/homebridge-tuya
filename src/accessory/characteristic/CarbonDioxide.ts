import { Service } from 'homebridge';
import { TuyaDeviceSchema, TuyaDeviceSchemaIntegerProperty } from '../../device/TuyaDevice';
import { limit } from '../../util/util';
import BaseAccessory from '../BaseAccessory';

// Above this level HomeKit's CarbonDioxideDetected reports "abnormal".
export const CO2_ABNORMAL_THRESHOLD_PPM = 1000;

export function configureCarbonDioxideSensor(
  accessory: BaseAccessory,
  service?: Service,
  co2LevelSchema?: TuyaDeviceSchema,
  abnormalThreshold = CO2_ABNORMAL_THRESHOLD_PPM,
) {
  if (!co2LevelSchema) {
    return;
  }

  if (!service) {
    service = accessory.accessory.getService(accessory.Service.CarbonDioxideSensor)
      || accessory.accessory.addService(accessory.Service.CarbonDioxideSensor);
  }

  const property = co2LevelSchema.property as TuyaDeviceSchemaIntegerProperty;
  const multiple = Math.pow(10, property ? property.scale : 0);
  const getLevel = () => {
    const status = accessory.getStatus(co2LevelSchema.code);
    if (!status) {
      return 0;
    }
    return limit(status.value as number / multiple, 0, 100000);
  };

  service.getCharacteristic(accessory.Characteristic.CarbonDioxideLevel)
    .onGet(getLevel);

  const { CO2_LEVELS_ABNORMAL, CO2_LEVELS_NORMAL } = accessory.Characteristic.CarbonDioxideDetected;
  service.getCharacteristic(accessory.Characteristic.CarbonDioxideDetected)
    .onGet(() => (getLevel() > abnormalThreshold ? CO2_LEVELS_ABNORMAL : CO2_LEVELS_NORMAL));
}

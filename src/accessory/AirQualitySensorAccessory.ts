import BaseAccessory from './BaseAccessory';
import { configureAirQuality } from './characteristic/AirQuality';
import { configureCarbonDioxideSensor } from './characteristic/CarbonDioxide';
import { configureCurrentRelativeHumidity } from './characteristic/CurrentRelativeHumidity';
import { configureCurrentTemperature } from './characteristic/CurrentTemperature';

const SCHEMA_CODE = {
  AIR_QUALITY: ['pm25_value'],
  PM2_5: ['pm25_value'],
  PM10: ['pm10_value', 'pm10'],
  VOC: ['voc_value', 'ch2o_value'],
  CO2_LEVEL: ['co2_value'],
  CURRENT_TEMP: ['va_temperature', 'temp_indoor', 'temp_current'],
  CURRENT_HUMIDITY: ['va_humidity', 'humidity_value'],
};

export default class AirQualitySensorAccessory extends BaseAccessory {

  requiredSchema() {
    return [SCHEMA_CODE.AIR_QUALITY];
  }

  configureServices() {
    configureAirQuality(
      this,
      undefined,
      this.getSchema(...SCHEMA_CODE.AIR_QUALITY),
      this.getSchema(...SCHEMA_CODE.PM2_5),
      this.getSchema(...SCHEMA_CODE.PM10),
      this.getSchema(...SCHEMA_CODE.VOC),
    );

    configureCarbonDioxideSensor(this, undefined, this.getSchema(...SCHEMA_CODE.CO2_LEVEL));

    // Other
    configureCurrentTemperature(this, undefined, this.getSchema(...SCHEMA_CODE.CURRENT_TEMP));
    configureCurrentRelativeHumidity(this, undefined, this.getSchema(...SCHEMA_CODE.CURRENT_HUMIDITY));
  }

}

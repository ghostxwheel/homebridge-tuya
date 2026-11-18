import { Service } from 'homebridge';
import BaseAccessory from './BaseAccessory';
import { configureAirQuality, configureDensity } from './characteristic/AirQuality';
import { configureCarbonDioxideSensor } from './characteristic/CarbonDioxide';
import { configureCurrentRelativeHumidity } from './characteristic/CurrentRelativeHumidity';
import { configureCurrentTemperature } from './characteristic/CurrentTemperature';
import { configureCustomAirQuality } from './characteristic/CustomAirQuality';

const SCHEMA_CODE = {
  PM2_5: ['pm25_value'],
  AIR_QUALITY_INDEX: ['air_quality_index'],
  PM10: ['pm10_value', 'pm10'],
  PM1: ['pm1_value', 'pm1'],
  VOC: ['voc_value'],
  CH2O: ['ch2o_value'],
  CO2_LEVEL: ['co2_value'],
  CURRENT_TEMP: ['va_temperature', 'temp_indoor', 'temp_current'],
  CURRENT_HUMIDITY: ['va_humidity', 'humidity_value'],
  TAMPER: ['tamper_alarm'],
  FAULT: ['fault'],
  LIFECYCLE: ['lifecycle'],
};

export default class AirQualitySensorAccessory extends BaseAccessory {

  requiredSchema() {
    // Any one measurement is enough; environmental detectors (hjjcy) vary a lot.
    return [[
      ...SCHEMA_CODE.PM2_5,
      ...SCHEMA_CODE.AIR_QUALITY_INDEX,
      ...SCHEMA_CODE.PM10,
      ...SCHEMA_CODE.VOC,
      ...SCHEMA_CODE.CH2O,
      ...SCHEMA_CODE.CO2_LEVEL,
    ]];
  }

  configureServices() {
    const pm25Schema = this.getSchema(...SCHEMA_CODE.PM2_5);
    const aqiSchema = this.getSchema(...SCHEMA_CODE.AIR_QUALITY_INDEX);
    const pm10Schema = this.getSchema(...SCHEMA_CODE.PM10);
    const pm1Schema = this.getSchema(...SCHEMA_CODE.PM1);
    const vocSchema = this.getSchema(...SCHEMA_CODE.VOC);
    const ch2oSchema = this.getSchema(...SCHEMA_CODE.CH2O);

    // HomeKit's AirQuality rating: PM2.5 when present, else the device's own index.
    const ratingSchema = pm25Schema ?? aqiSchema;
    // HomeKit has no formaldehyde characteristic; report it as VOC unless the device has real VOC.
    const vocLikeSchema = vocSchema ?? ch2oSchema;

    if (ratingSchema || pm10Schema || pm1Schema || vocLikeSchema) {
      const airQualityService = this.airQualityService();
      if (ratingSchema) {
        configureAirQuality(this, airQualityService, ratingSchema, pm25Schema, pm10Schema, vocLikeSchema);
      } else {
        airQualityService.getCharacteristic(this.Characteristic.AirQuality)
          .onGet(() => this.Characteristic.AirQuality.UNKNOWN);
        configureDensity(this, airQualityService, this.Characteristic.PM10Density, pm10Schema);
        configureDensity(this, airQualityService, this.Characteristic.VOCDensity, vocLikeSchema);
      }
      configureCustomAirQuality(this, airQualityService, pm1Schema, ch2oSchema, aqiSchema);
    }

    configureCarbonDioxideSensor(this, undefined, this.getSchema(...SCHEMA_CODE.CO2_LEVEL));

    // Other
    configureCurrentTemperature(this, undefined, this.getSchema(...SCHEMA_CODE.CURRENT_TEMP));
    configureCurrentRelativeHumidity(this, undefined, this.getSchema(...SCHEMA_CODE.CURRENT_HUMIDITY));

    this.configureSensorStatus();
  }

  airQualityService() {
    return this.accessory.getService(this.Service.AirQualitySensor)
      || this.accessory.addService(this.Service.AirQualitySensor);
  }

  sensorServices(): Service[] {
    return [
      this.Service.AirQualitySensor,
      this.Service.CarbonDioxideSensor,
      this.Service.TemperatureSensor,
      this.Service.HumiditySensor,
    ].map(type => this.accessory.getService(type)).filter((service): service is Service => !!service);
  }

  configureSensorStatus() {
    const tamperSchema = this.getSchema(...SCHEMA_CODE.TAMPER);
    const faultSchema = this.getSchema(...SCHEMA_CODE.FAULT);
    const lifecycleSchema = this.getSchema(...SCHEMA_CODE.LIFECYCLE);

    for (const service of this.sensorServices()) {
      if (tamperSchema) {
        const { TAMPERED, NOT_TAMPERED } = this.Characteristic.StatusTampered;
        service.getCharacteristic(this.Characteristic.StatusTampered)
          .onGet(() => (this.getStatus(tamperSchema.code)?.value === true ? TAMPERED : NOT_TAMPERED));
      }

      if (faultSchema || lifecycleSchema) {
        const { GENERAL_FAULT, NO_FAULT } = this.Characteristic.StatusFault;
        service.getCharacteristic(this.Characteristic.StatusFault)
          .onGet(() => {
            // `fault` is a bitmap: any bit set is a fault. `lifecycle` true = sensor end of life.
            const fault = faultSchema && Number(this.getStatus(faultSchema.code)?.value ?? 0) !== 0;
            const expired = lifecycleSchema && this.getStatus(lifecycleSchema.code)?.value === true;
            return (fault || expired) ? GENERAL_FAULT : NO_FAULT;
          });
      }
    }
  }

}

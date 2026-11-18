import { Service } from 'homebridge';
import { TuyaDeviceSchema } from '../device/TuyaDevice';
import BaseAccessory from './BaseAccessory';
import { configureAirQuality, createDensityGetter } from './characteristic/AirQuality';
import { configureCarbonDioxideSensor } from './characteristic/CarbonDioxide';
import { configureCurrentRelativeHumidity } from './characteristic/CurrentRelativeHumidity';
import { configureCurrentTemperature } from './characteristic/CurrentTemperature';
import { configureName } from './characteristic/Name';

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

// Extra AirQualitySensor services, one per measurement HomeKit has no own sensor type for.
const SUBTYPE = {
  PM1: 'pm1',
  CH2O: 'ch2o',
  AIR_QUALITY_INDEX: 'air_quality_index',
};

// Custom characteristics published by 2.7.1+aq.2; removed from cached accessories.
const LEGACY_CUSTOM_UUIDS = [
  '5A15DE85-A43B-5E00-AA4E-055A507F3B0C', // PM1 Density
  '882A6799-0E15-5B85-8AFC-8BD2AEB8BF53', // Formaldehyde Density
  '3F7E7310-EA92-5E79-9D23-2431D4BBA54B', // Air Quality Level
];

// Formaldehyde rating thresholds in µg/m³ (WHO 30-minute guideline is 100 µg/m³).
const CH2O_LEVELS = [30, 60, 100, 200];

export default class AirQualitySensorAccessory extends BaseAccessory {

  requiredSchema() {
    // Any one measurement is enough; environmental detectors (hjjcy) vary a lot.
    return [[
      ...SCHEMA_CODE.PM2_5,
      ...SCHEMA_CODE.AIR_QUALITY_INDEX,
      ...SCHEMA_CODE.PM10,
      ...SCHEMA_CODE.PM1,
      ...SCHEMA_CODE.VOC,
      ...SCHEMA_CODE.CH2O,
      ...SCHEMA_CODE.CO2_LEVEL,
    ]];
  }

  configureServices() {
    const pm25Schema = this.getSchema(...SCHEMA_CODE.PM2_5);
    const aqiSchema = this.getSchema(...SCHEMA_CODE.AIR_QUALITY_INDEX);
    const pm10Schema = this.getSchema(...SCHEMA_CODE.PM10);
    const vocSchema = this.getSchema(...SCHEMA_CODE.VOC);

    // Main sensor: PM2.5 / PM10 / VOC, rated by PM2.5 (or the device index without PM2.5).
    if (pm25Schema || pm10Schema || vocSchema) {
      const service = this.mainAirQualityService();
      const ratingSchema = pm25Schema ?? aqiSchema;
      if (ratingSchema) {
        configureAirQuality(this, service, ratingSchema, pm25Schema, pm10Schema, vocSchema);
      } else {
        service.getCharacteristic(this.Characteristic.AirQuality)
          .onGet(() => this.Characteristic.AirQuality.UNKNOWN);
        this.configureDensity(service, this.Characteristic.PM10Density, pm10Schema);
        this.configureDensity(service, this.Characteristic.VOCDensity, vocSchema);
      }
      this.removeStaleCharacteristics(service, vocSchema);
    }

    this.configurePM1Sensor(this.getSchema(...SCHEMA_CODE.PM1));
    this.configureFormaldehydeSensor(this.getSchema(...SCHEMA_CODE.CH2O));
    this.configureAirQualityIndexSensor(aqiSchema);

    configureCarbonDioxideSensor(this, undefined, this.getSchema(...SCHEMA_CODE.CO2_LEVEL));

    // Other
    configureCurrentTemperature(this, undefined, this.getSchema(...SCHEMA_CODE.CURRENT_TEMP));
    configureCurrentRelativeHumidity(this, undefined, this.getSchema(...SCHEMA_CODE.CURRENT_HUMIDITY));

    this.configureSensorStatus();
  }

  mainAirQualityService(): Service {
    // `getService(type)` may return a subtyped sibling; the main service has no subtype.
    return this.accessory.services.find(s => s.UUID === this.Service.AirQualitySensor.UUID && !s.subtype)
      || this.accessory.addService(this.Service.AirQualitySensor);
  }

  extraAirQualityService(subtype: string, label: string): Service {
    const name = `${this.device.name} ${label}`;
    const service = this.accessory.getServiceById(this.Service.AirQualitySensor, subtype)
      || this.accessory.addService(this.Service.AirQualitySensor, name, subtype);
    configureName(this, service, name);
    return service;
  }

  removeExtraService(subtype: string) {
    const service = this.accessory.getServiceById(this.Service.AirQualitySensor, subtype);
    service && this.accessory.removeService(service);
  }

  configurePM1Sensor(schema?: TuyaDeviceSchema) {
    if (!schema) {
      this.removeExtraService(SUBTYPE.PM1);
      return;
    }
    // HomeKit has no PM1 characteristic: carry PM1 in this sensor's PM2.5 density, rated like PM2.5.
    const service = this.extraAirQualityService(SUBTYPE.PM1, 'PM1');
    configureAirQuality(this, service, schema, schema);
  }

  configureFormaldehydeSensor(schema?: TuyaDeviceSchema) {
    if (!schema) {
      this.removeExtraService(SUBTYPE.CH2O);
      return;
    }
    // HomeKit has no formaldehyde characteristic: carry it in VOC density (µg/m³).
    const service = this.extraAirQualityService(SUBTYPE.CH2O, 'Formaldehyde');
    const getDensity = createDensityGetter(this, schema);
    service.getCharacteristic(this.Characteristic.VOCDensity).onGet(getDensity);

    const { EXCELLENT, GOOD, FAIR, INFERIOR, POOR } = this.Characteristic.AirQuality;
    const ratings = [EXCELLENT, GOOD, FAIR, INFERIOR];
    service.getCharacteristic(this.Characteristic.AirQuality).onGet(() => {
      const value = getDensity();
      const index = CH2O_LEVELS.findIndex(max => value <= max);
      return index === -1 ? POOR : ratings[index];
    });
  }

  configureAirQualityIndexSensor(schema?: TuyaDeviceSchema) {
    if (!schema) {
      this.removeExtraService(SUBTYPE.AIR_QUALITY_INDEX);
      return;
    }
    const service = this.extraAirQualityService(SUBTYPE.AIR_QUALITY_INDEX, 'AQI');
    configureAirQuality(this, service, schema);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configureDensity(service: Service, characteristic: any, schema?: TuyaDeviceSchema) {
    if (schema) {
      service.getCharacteristic(characteristic).onGet(createDensityGetter(this, schema));
    }
  }

  removeStaleCharacteristics(service: Service, vocSchema?: TuyaDeviceSchema) {
    // Earlier fork builds put custom characteristics and formaldehyde-as-VOC on the main
    // sensor; drop them from cached accessories so they don't linger with frozen values.
    for (const characteristic of [...service.characteristics]) {
      if (LEGACY_CUSTOM_UUIDS.includes(characteristic.UUID)) {
        service.removeCharacteristic(characteristic);
      }
    }
    if (!vocSchema && service.testCharacteristic(this.Characteristic.VOCDensity)) {
      service.removeCharacteristic(service.getCharacteristic(this.Characteristic.VOCDensity));
    }
  }

  sensorServices(): Service[] {
    const types = [
      this.Service.AirQualitySensor,
      this.Service.CarbonDioxideSensor,
      this.Service.TemperatureSensor,
      this.Service.HumiditySensor,
    ].map(type => type.UUID);
    return this.accessory.services.filter(service => types.includes(service.UUID));
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

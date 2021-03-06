import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as Chance from 'chance';
import { jar } from 'request';
import { Cookie, CookieJar, MemoryCookieStore } from 'tough-cookie';
import * as devices from '../samples/devices.json';
import * as builds from '../samples/builds.json';
import * as supportedCapabilities from '../samples/supported-capabilities.json';
import {
  APP_VERSION,
  APP_VERSION_CODE,
  BREADCRUMB_KEY,
  EXPERIMENTS,
  FACEBOOK_ANALYTICS_APPLICATION_ID,
  FACEBOOK_ORCA_APPLICATION_ID,
  FACEBOOK_OTA_FIELDS,
  HOST,
  LOGIN_EXPERIMENTS,
  SIGNATURE_KEY,
  SIGNATURE_VERSION,
} from './constants';
import { ChallengeStateResponse, CheckpointResponse } from '../responses';
import { IgCookieNotFoundError, IgNoCheckpointError, IgUserIdNotFoundError } from '../errors';

export class State {
  signatureKey: string = SIGNATURE_KEY;
  signatureVersion: string = SIGNATURE_VERSION;
  userBreadcrumbKey: string = BREADCRUMB_KEY;
  appVersion: string = APP_VERSION;
  appVersionCode: string = APP_VERSION_CODE;
  fbAnalyticsApplicationId: string = FACEBOOK_ANALYTICS_APPLICATION_ID;
  fbOtaFields: string = FACEBOOK_OTA_FIELDS;
  fbOrcaApplicationId: string = FACEBOOK_ORCA_APPLICATION_ID;
  loginExperiments: string = LOGIN_EXPERIMENTS;
  experiments: string = EXPERIMENTS;
  supportedCapabilities = supportedCapabilities;
  language: string = 'en_US';
  timezoneOffset: string = String(new Date().getTimezoneOffset() * -60);
  radioType = 'wifi-none';
  capabilitiesHeader = '3brTvw==';
  connectionTypeHeader = 'WIFI';
  deviceString: string;
  build: string;
  uuid: string;
  phoneId: string;
  userAgent: string;
  /**
   * Google Play Advertising ID.
   *
   * The advertising ID is a unique ID for advertising, provided by Google
   * Play services for use in Google Play apps. Used by Instagram.
   *
   * @see https://support.google.com/googleplay/android-developer/answer/6048248?hl=en
   */
  adid: string;
  deviceId: string;
  proxyUrl: string;
  cookieStore = new MemoryCookieStore();
  cookieJar = jar(this.cookieStore);
  checkpoint: CheckpointResponse | null = null;
  challenge: ChallengeStateResponse | null = null;
  fixedSessionId: null = null; // to use when we want to pass exact value instead of generating it
  clientSessionIdLifetime: number = 1200000;
  pigeonSessionIdLifetime: number = 1200000;
  clientSessionIdSalt: string = `${Date.now()}`;
  pigeonSessionIdSalt: string = `${Date.now()}`;

  /**
   * The current application session ID.
   *
   * This is a temporary ID which changes in the official app every time the
   * user closes and re-opens the Instagram application or switches account.
   *
   * We will update it once an hour
   */
  public get clientSessionId(): string {
    return this.generateSaltyGuid('clientSessionId', this.clientSessionIdSalt);
  }

  // return set session id if it's present
  public get fixedClientSessionId(): string {
    return this.fixedSessionId || this.clientSessionId;
  }

  public get pigeonSessionId(): string {
    return this.generateSaltyGuid('pigeonSessionId', this.pigeonSessionIdSalt);
  }

  public get appUserAgent() {
    return `Instagram ${this.appVersion} Android (${this.deviceString}; ${this.language}; ${this.appVersionCode})`;
  }

  public get deviceAndroidRelease() {
    return this.deviceString.split('; ')[0];
  }

  public get dpi() {
    return Number(this.deviceString.split('; ')[1].replace('dpi', ''));
  }

  public get resolution() {
    let res = this.deviceString.split('; ')[2].split('x');
    return {
      height: res[1],
      width: res[0],
    };
  }

  public get deviceManufacturer() {
    return this.deviceString.split('; ')[3];
  }

  public get deviceModel() {
    return this.deviceString.split('; ')[4];
  }

  public get webUserAgent() {
    return `Mozilla/5.0 (Linux; Android ${this.devicePayload.android_release}; ${this.devicePayload.model} Build/${
      this.build
    }; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.110 Mobile Safari/537.36 ${
      this.appUserAgent
    }`;
  }

  public get fbUserAgent() {
    let resolution = this.resolution;

    let props = {
      FBAN: 'InstagramForAndroid',
      FBAV: this.appVersion,
      FBBV: this.appVersionCode,
      FBDM: `{density=4.0,width=${resolution.width},height=${resolution.height}}`,
      FBLC: this.language,
      FBCR: '',
      FBMF: this.deviceManufacturer.toUpperCase(),
      FBBD: this.deviceManufacturer.toUpperCase(),
      FBPN: 'com.instagram.android',
      FBDV: this.deviceModel.toUpperCase(),
      FBSV: '7.0',
      FBBK: 1,
      FBCA: 'armeabi-v7a:armeabi',
    };

    let result = '';
    for (let key in props) {
      if (props.hasOwnProperty(key)) {
        result += `${key}/${props[key]};`;
      }
    }

    return `[${result}]`;
  }

  public get devicePayload() {
    const deviceParts = this.deviceString.split(';');
    const [android_version, android_release] = deviceParts[0].split('/');
    const [manufacturer] = deviceParts[3].split('/');
    const model = deviceParts[4];
    return {
      android_version,
      android_release,
      manufacturer,
      model,
    };
  }

  public get batteryLevel() {
    const chance = new Chance(this.deviceId);
    const percentTime = chance.integer({ min: 200, max: 600 });
    return 100 - (Math.round(Date.now() / 1000 / percentTime) % 100);
  }

  public get isCharging() {
    const chance = new Chance(`${this.deviceId}${Math.round(Date.now() / 10800000)}`);
    return chance.bool();
  }

  public get challengeUrl() {
    if (!this.checkpoint) {
      throw new IgNoCheckpointError();
    }
    return `/api/v1${this.checkpoint.challenge.api_path}`;
  }

  public get cookieCsrfToken() {
    try {
      return this.extractCookieValue('csrftoken');
    } catch {
      return 'missing';
    }
  }

  public get cookieUserId() {
    try {
      return this.extractCookieValue('ds_user_id');
    } catch (e) {
      return '0';
    }
  }

  public get cookieUsername() {
    return this.extractCookieValue('ds_user');
  }

  public isExperimentEnabled(experiment) {
    return this.experiments.includes(experiment);
  }

  public extractCookie(key: string): Cookie | null {
    const cookies = this.cookieJar.getCookies(HOST);
    return _.find(cookies, { key }) || null;
  }

  public extractCookieValue(key: string): string {
    const cookie = this.extractCookie(key);
    if (cookie === null) {
      throw new IgCookieNotFoundError(key);
    }
    return cookie.value;
  }

  public extractUserId(): string {
    try {
      return this.cookieUserId;
    } catch (e) {
      if (this.challenge === null || !this.challenge.user_id) {
        throw new IgUserIdNotFoundError();
      }
      return String(this.challenge.user_id);
    }
  }

  public async deserializeCookieJar(cookies: string) {
    this.cookieJar['_jar'] = await Bluebird.fromCallback(cb => CookieJar.deserialize(cookies, this.cookieStore, cb));
  }

  public async serializeCookieJar(): Promise<CookieJar.Serialized> {
    return Bluebird.fromCallback(cb => this.cookieJar['_jar'].serialize(cb));
  }

  public generateDevice(seed: string): void {
    const chance = new Chance(seed);
    this.deviceString = chance.pickone(devices);
    const id = chance.string({
      pool: 'abcdef0123456789',
      length: 16,
    });
    this.deviceId = `android-${id}`;
    this.uuid = chance.guid({ version: 4 });
    this.phoneId = chance.guid({ version: 4 });
    this.adid = chance.guid({ version: 4 });
    this.build = chance.pickone(builds);
  }

  private generateSaltyGuid(seed: string, salt: string) {
    return new Chance(`${seed}${this.deviceId}${salt}`).guid({ version: 4 });
  }
}

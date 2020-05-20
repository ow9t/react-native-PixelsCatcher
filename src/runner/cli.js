#!/usr/bin/env node
/**
* Copyright (c) Maksym Rusynyk 2018 - present
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
/* @flow */
import type { DeviceInterface } from './utils/device/DeviceInterface';

const fs = require('fs');
const path = require('path');

const server = require('./server/server');
const log = require('./utils/log');
const readConfig = require('./utils/readConfig');
const getDevice = require('./utils/device/deviceProvider');
const Reporter = require('./utils/Reporter');

const TAG = 'PIXELS_CATCHER';
const [,, platform, configuration] = process.argv;

if (!platform || !(platform === 'ios' || platform === 'android')) {
  log.e(TAG, `Valid platform is requred, specify "ios" or "android". Example:

  $ pixels-catcher android debug

  or

  $ pixels-catcher ios debug
  `);
  process.exit(-1);
}

if (!configuration) {
  log.e(TAG, `Configuration is required. Example:

  $ pixels-catcher android debug

  or

  $ pixels-catcher ios debug
`);
  process.exit(-1);
}


const fullConfig = readConfig();
const config = fullConfig[platform];

if (!config) {
  log.e(TAG, `Cannot find configuration for plarform [${platform}] in `
    + `config:\n ${JSON.stringify(fullConfig, null, 2)}`);
  process.exit(-1);
}

log.setLevel(fullConfig.logLevelel);
log.i(TAG, `Starting snapshots with [${configuration}] configuration for [${platform}]`);
log.v(TAG, 'Using config\n' + JSON.stringify(config, null, 2));

const getParamFromConfig = (paramName: string) => {
  const value = (config[configuration] || {})[paramName];
  return value !== undefined ? value : config[paramName];
};

const activityName = getParamFromConfig('activityName') || 'MainActivity';
const appFile = getParamFromConfig('appFile');
const canStopDevice = getParamFromConfig('canStopDevice');
const deviceName = getParamFromConfig('deviceName');
const deviceParams = getParamFromConfig('deviceParams');
const isPhysicalDevice = getParamFromConfig('physicalDevice');
const packageName = getParamFromConfig('packageName');
const snapshotsPath = getParamFromConfig('snapshotsPath');
const port = getParamFromConfig('port');
const locale = getParamFromConfig('locale');
const timeout = fullConfig.timeout || 25 * 1000; // 25 sec is default

if (!deviceName) {
  log.e(TAG, 'Valid device name is required, check "PixelsCatcher.deviceName" '
    + 'sproperty in package.json');
  process.exit(-1);
}

const device: DeviceInterface = getDevice(
  deviceName,
  platform,
  isPhysicalDevice,
  canStopDevice,
);

const DEV_MODE = !appFile;

log.i(TAG, `Starting in ${DEV_MODE ? 'development' : 'ci'} mode`);

log.i(TAG, `Using config:
  - activityName: [${activityName}]
  - appFile: [${appFile}]
  - deviceName: [${deviceName}]
  - deviceParams: [${deviceParams}]
  - packageName: [${packageName}]
  - snapshotsPath: [${snapshotsPath}]
  - canStopDevice: [${canStopDevice}]
  - port: [${port}]
  - locale: [${locale}]`);

if (!packageName) {
  log.e(TAG, 'Package name is required');
  process.exit(-1);
}

let appFileFullPath;
if (!DEV_MODE) {
  if (!appFile) {
    log.e(TAG, 'Valid ap file is required, check config');
    process.exit(-1);
  }

  appFileFullPath = path.isAbsolute(appFile)
    ? appFile : path.join(process.cwd(), appFile);

  if (!fs.existsSync(appFileFullPath)) {
    log.e(TAG, `Valid app file is required, cannot find [${appFile}] file`);
    process.exit(-1);
  }
}

let stopByTimeoutID: TimeoutID | void;
const reporter = new Reporter(`UI tests for ${platform}/${deviceName}`);
const jUnitFile = path.join(process.cwd(), 'junit.xml');

const testingCompleted = async (isPassed: boolean = false) => {
  if (stopByTimeoutID) {
    clearTimeout(stopByTimeoutID);
  }
  if (!DEV_MODE) {
    log.i(TAG, 'Stopping the server and emulator');
    await server.stop();
    await device.stop();
    log.i(TAG, 'Server and emulator are stopped');

    if (!isPassed) {
      log.i(TAG, 'Some tests failed, exit with error');
      process.exit(-1);
    } else {
      log.i(TAG, 'No errors, normal exit');
    }
  }
};

const stopByTimeout = () => {
  if (stopByTimeoutID) {
    clearTimeout(stopByTimeoutID);
  }
  stopByTimeoutID = setTimeout(() => {
    log.e(TAG, 'Stop tests by timeout');
    testingCompleted();
  }, timeout);
};

const onAppActivity = () => {
  stopByTimeout();
};

const onTestsCompleted = async () => {
  reporter.toLog();
  reporter.tojUnit(jUnitFile);
  testingCompleted(reporter.isPassed());
};

const startAndroid = async () => {
  log.d(TAG, `Start emulator [${deviceName}]`);
  try {
    await device.start(deviceParams);
  } catch (err) {
    process.exit(-1);
  }
  log.d(TAG, 'Emulator started');

  log.d(TAG, 'Installing APK');
  await device.installApp(packageName, appFileFullPath);
  log.d(TAG, 'APK installed');

  log.d(TAG, 'Starting application');
  if (locale) {
    log.w(TAG, `[${locale} is ignored for android]`);
  }
  await device.startApp(packageName, activityName);
  log.d(TAG, 'Application started');

  stopByTimeout();
};

const startIOS = async () => {
  log.d(TAG, `Start emulator [${deviceName}]`);
  try {
    await device.start(deviceParams);
  } catch (err) {
    log.e(TAG, `Failed to start device: [${err.mesage}]`);
    process.exit(-1);
  }
  log.d(TAG, 'Emulator started');

  log.d(TAG, 'Installing APP');
  await device.installApp(packageName, appFileFullPath);
  log.d(TAG, 'APP installed');

  log.d(TAG, 'Starting application');
  await device.startApp(packageName, activityName, locale);
  log.d(TAG, 'Application started');
};

const start = async () => {
  log.d(TAG, 'Starting server');
  await server.start(
    reporter,
    onTestsCompleted,
    snapshotsPath,
    onAppActivity,
    port,
  );
  log.d(TAG, 'Server started');

  if (DEV_MODE) {
    log.d(TAG, 'Only server is used in DEV mode. Waiting for tests');
    return;
  }

  if (platform === 'ios') {
    startIOS();
  } else {
    startAndroid();
  }
};

start();

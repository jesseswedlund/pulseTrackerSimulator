// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

"use strict";

//azure IoT packages
const Protocol = require("azure-iot-device-mqtt").Mqtt;
const ProvProtocol = require("azure-iot-provisioning-device-mqtt").Mqtt;
const Client = require("azure-iot-device").Client;
const Message = require("azure-iot-device").Message;
const ConnectionString = require("azure-iot-common").ConnectionString;
const SymmetricKeySecurityClient =
  require("azure-iot-security-symmetric-key").SymmetricKeySecurityClient;
const ProvisioningDeviceClient =
  require("azure-iot-provisioning-device").ProvisioningDeviceClient;
const { data } = require("./data");

// String containing Hostname, Device Id & Device Key in the following formats:
//  'HostName=<iothub_host_name>;DeviceId=<device_id>;SharedAccessKey=<device_key>'
let deviceConnectionString = process.env.IOTHUB_DEVICE_CONNECTION_STRING;

// DPS connection information
const provisioningHost =
  process.env.IOTHUB_DEVICE_DPS_ENDPOINT ||
  "global.azure-devices-provisioning.net";
const idScope = process.env.IOTHUB_DEVICE_DPS_ID_SCOPE;
const registrationId = process.env.IOTHUB_DEVICE_DPS_DEVICE_ID;
const symmetricKey = process.env.IOTHUB_DEVICE_DPS_DEVICE_KEY;
const useDps = process.env.IOTHUB_DEVICE_SECURITY_TYPE;

const modelIdObject = { modelId: "dtmi:com:example:FitnessTracker;2" };
const messageSubjectProperty = "$.sub";
const fitnessTracker1ComponentName = "fitnesstracker1";
const deviceInfoComponentName = "deviceInformation";
const commandComponentCommandNameSeparator = "*";
let intervalToken1;

class PulseSensor {
  constructor() {
    this.index = 0;
    this.increasing = true;
    this.currPulse = data[this.index];
    this.maxPulse = this.currPulse;
    this.minPulse = this.currPulse;
    this.cumulativePulse = this.currPulse;
    this.startTime = new Date(Date.now()).toISOString();
    this.numberOfPulseReadings = 1;
  }
  getCurrentPulseObject() {
    return { pulse: this.currPulse };
  }
  updateSensor() {
    if (this.increasing) {
      ++this.index;
      if (this.index < data.length) {
        this.currPulse = data[this.index];
      } else {
        this.increasing = false;
        --this.index;
        this.currPulse = data[this.index];
      }
    } else {
      --this.index;
      if (this.index > -1) {
        this.currPulse = data[this.index];
      } else {
        this.increasing = true;
        ++this.index;
        this.currPulse = data[this.index];
      }
    }
    this.cumulativePulse += this.currPulse;
    this.numberOfPulseReadings++;
    if (this.currPulse > this.maxPulse) {
      this.maxPulse = this.currPulse;
    }
    if (this.currPulse < this.minPulse) {
      this.minPulse = this.currPulse;
    }
    return this;
  }
  getMaxMinReportObject() {
    return {
      maxPulse: this.maxPulse,
      minPulse: this.minPulse,
      avgPulse: this.cumulativePulse / this.numberOfPulseReadings,
      endTime: new Date(Date.now()).toISOString(),
      startTime: this.startTime,
    };
  }
  getMaxPulseValue() {
    return this.maxPulse;
  }
}

const fitnessTracker1 = new PulseSensor();

const commandNameGetMaxMinReport1 =
  fitnessTracker1ComponentName +
  commandComponentCommandNameSeparator +
  "getMaxMinReport";
const commandNameReboot = "reboot";
const serialNumber = "alwinexlepaho8329";

const commandHandler = async (request, response) => {
  helperLogCommandRequest(request);
  switch (request.methodName) {
    case commandNameGetMaxMinReport1: {
      await sendCommandResponse(
        request,
        response,
        200,
        fitnessTrackerstat1.getMaxMinReportObject()
      );
      break;
    }
    case commandNameReboot: {
      await sendCommandResponse(request, response, 200, "reboot response");
      break;
    }
    default:
      await sendCommandResponse(request, response, 404, "unknown method");
      break;
  }
};

const sendCommandResponse = async (request, response, status, payload) => {
  try {
    await response.send(status, payload);
    console.log(
      "Response to method: " + request.methodName + " sent successfully."
    );
  } catch (err) {
    console.error(
      "An error ocurred when sending a method response:\n" + err.toString()
    );
  }
};

const helperLogCommandRequest = (request) => {
  console.log(
    "Received command request for command name: " + request.methodName
  );

  if (!!request.payload) {
    console.log("The command request payload is:");
    console.log(request.payload);
  }
};

const helperCreateReportedPropertiesPatch = (
  propertiesToReport,
  componentName
) => {
  let patch;
  if (!!componentName) {
    patch = {};
    propertiesToReport.__t = "c";
    patch[componentName] = propertiesToReport;
  } else {
    patch = {};
    patch = propertiesToReport;
  }
  if (!!componentName) {
    console.log(
      "The following properties will be updated for component: " + componentName
    );
  } else {
    console.log("The following properties will be updated for root interface.");
  }
  console.log(patch);
  return patch;
};

const updateComponentReportedProperties = (
  deviceTwin,
  patch,
  componentName
) => {
  let logLine;
  if (!!componentName) {
    logLine = "Properties have been reported for component: " + componentName;
  } else {
    logLine = "Properties have been reported for root interface.";
  }
  deviceTwin.properties.reported.update(patch, function (err) {
    if (err) throw err;
    console.log(logLine);
  });
};

const desiredPropertyPatchListener = (deviceTwin, componentNames) => {
  deviceTwin.on("properties.desired", (delta) => {
    console.log(
      "Received an update for device with value: " + JSON.stringify(delta)
    );
    Object.entries(delta).forEach(([key, values]) => {
      const version = delta.$version;
      if (!!componentNames && componentNames.includes(key)) {
        // then it is a component we are expecting
        const componentName = key;
        const patchForComponents = { [componentName]: {} };
        Object.entries(values).forEach(([propertyName, propertyValue]) => {
          if (propertyName !== "__t" && propertyName !== "$version") {
            console.log(
              "Will update property: " +
                propertyName +
                " to value: " +
                propertyValue +
                " of component: " +
                componentName
            );
            const propertyContent = { value: propertyValue };
            propertyContent.ac = 200;
            propertyContent.ad = "Successfully executed patch";
            propertyContent.av = version;
            patchForComponents[componentName][propertyName] = propertyContent;
          }
        });
        updateComponentReportedProperties(
          deviceTwin,
          patchForComponents,
          componentName
        );
      } else if (key !== "$version") {
        // individual property for root
        const patchForRoot = {};
        console.log(
          "Will update property: " + key + " to value: " + values + " for root"
        );
        const propertyContent = { value: values };
        propertyContent.ac = 200;
        propertyContent.ad = "Successfully executed patch";
        propertyContent.av = version;
        patchForRoot[key] = propertyContent;
        updateComponentReportedProperties(deviceTwin, patchForRoot, null);
      }
    });
  });
};

const exitListener = async (deviceClient) => {
  const standardInput = process.stdin;
  standardInput.setEncoding("utf-8");
  console.log("Please enter q or Q to exit sample.");
  standardInput.on("data", (data) => {
    if (data === "q\n" || data === "Q\n") {
      console.log("Clearing intervals and exiting sample.");
      clearInterval(intervalToken1);
      deviceClient.close();
      process.exit();
    } else {
      console.log("User Input was: " + data);
      console.log("Please only enter q or Q to exit sample.");
    }
  });
};

async function sendTelemetry(deviceClient, data, index, componentName) {
  if (!!componentName) {
    console.log(
      "Sending telemetry message %d from component: %s ",
      index,
      componentName
    );
  } else {
    console.log("Sending telemetry message %d from root interface", index);
  }
  const msg = new Message(data);
  if (!!componentName) {
    msg.properties.add(messageSubjectProperty, componentName);
  }
  msg.contentType = "application/json";
  msg.contentEncoding = "utf-8";
  await deviceClient.sendEvent(msg);
}

async function provisionDevice(payload) {
  var provSecurityClient = new SymmetricKeySecurityClient(
    registrationId,
    symmetricKey
  );
  var provisioningClient = ProvisioningDeviceClient.create(
    provisioningHost,
    idScope,
    new ProvProtocol(),
    provSecurityClient
  );

  if (!!payload) {
    provisioningClient.setProvisioningPayload(payload);
  }

  try {
    let result = await provisioningClient.register();
    deviceConnectionString =
      "HostName=" +
      result.assignedHub +
      ";DeviceId=" +
      result.deviceId +
      ";SharedAccessKey=" +
      symmetricKey;
    console.log("registration succeeded");
    console.log("assigned hub=" + result.assignedHub);
    console.log("deviceId=" + result.deviceId);
    console.log("payload=" + JSON.stringify(result.payload));
  } catch (err) {
    console.error("error registering device: " + err.toString());
  }
}

async function main() {
  // If the user include a provision host then use DPS
  if (useDps === "DPS") {
    await provisionDevice(modelIdObject);
  } else if (useDps === "connectionString") {
    try {
      if (
        !(
          deviceConnectionString &&
          ConnectionString.parse(deviceConnectionString, [
            "HostName",
            "DeviceId",
          ])
        )
      ) {
        console.error("Connection string was not specified.");
        process.exit(1);
      }
    } catch (err) {
      console.error("Invalid connection string specified.");
      process.exit(1);
    }
  } else {
    console.log("No proper SECURITY TYPE provided.");
    process.exit(1);
  }

  // fromConnectionString must specify a transport, coming from any transport package.
  const client = Client.fromConnectionString(deviceConnectionString, Protocol);
  console.log("Connecting using connection string: " + deviceConnectionString);
  let resultTwin;

  try {
    // Add the modelId here
    await client.setOptions(modelIdObject);
    await client.open();
    console.log("Enabling the commands on the client");
    client.onDeviceMethod(commandNameGetMaxMinReport1, commandHandler);
    client.onDeviceMethod(commandNameReboot, commandHandler);

    // Send Telemetry after some interval
    let index1 = 0;

    intervalToken1 = setInterval(() => {
      const { pulse } = fitnessTracker1.updateSensor().getCurrentPulseObject();
      const maxMin = fitnessTracker1.getMaxMinReportObject();
      const data = JSON.stringify({ ...maxMin, pulse: pulse });
      sendTelemetry(client, data, index1, fitnessTracker1ComponentName).catch(
        (err) => console.log("error ", err.toString())
      );
      index1 += 1;
    }, 5000);

    // attach a standard input exit listener
    exitListener(client);

    try {
      resultTwin = await client.getTwin();
      // Only report readable properties
      const patchRoot = helperCreateReportedPropertiesPatch(
        { serialNumber: serialNumber },
        null
      );
      const patchfitnessTracker1Info = helperCreateReportedPropertiesPatch(
        {
          maxPulseSinceLastReboot: fitnessTracker1.getMaxPulseValue(),
        },
        fitnessTracker1ComponentName
      );

      const patchDeviceInfo = helperCreateReportedPropertiesPatch(
        {
          manufacturer: "Fitbit",
          model: "",
          swVersion: "10.89",
          osName: "Contoso_OS",
          processorArchitecture: "Contoso_x86",
          processorManufacturer: "Contoso Industries",
          totalStorage: 65000,
          totalMemory: 640,
        },
        deviceInfoComponentName
      );

      // the below things can only happen once the twin is there
      updateComponentReportedProperties(resultTwin, patchRoot, null);
      updateComponentReportedProperties(
        resultTwin,
        patchfitnessTracker1Info,
        fitnessTracker1ComponentName
      );
      updateComponentReportedProperties(
        resultTwin,
        patchDeviceInfo,
        deviceInfoComponentName
      );
      desiredPropertyPatchListener(resultTwin, [
        fitnessTracker1ComponentName,
        deviceInfoComponentName,
      ]);
    } catch (err) {
      console.error(
        "could not retrieve twin or report twin properties\n" + err.toString()
      );
    }
  } catch (err) {
    console.error(
      "could not connect Plug and Play client or could not attach interval function for telemetry\n" +
        err.toString()
    );
  }
}

main()
  .then(() => console.log("executed sample"))
  .catch((err) => console.log("error", err));

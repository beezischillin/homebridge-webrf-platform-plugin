import axios                                     from "axios";
import * as _                                    from "lodash";
import {
  API, APIEvent, CharacteristicEventTypes,
  CharacteristicSetCallback, CharacteristicValue,
  DynamicPlatformPlugin, HAP, Logging,
  PlatformAccessory, PlatformAccessoryEvent,
  PlatformConfig,
}                                                from "homebridge";

const PLUGIN_NAME   = "WebRF_Plugin";
const PLATFORM_NAME = "WebRFPlatform";

let hap: HAP;
let Accessory: typeof PlatformAccessory;

export = (api: API) => {
  hap       = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLATFORM_NAME, WebRFPlatform);
};

class WebRFPlatform implements DynamicPlatformPlugin {
  private readonly log:         Logging;
  private readonly api:         API;
  private readonly configURL:   string;
  private readonly accessories: PlatformAccessory[] = [];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log       = log;
    this.api       = api;
    this.configURL = config.url.trimRight("/") + "/api/v1/";

    log.info("Starting WebRF Plugin");

    /*
     * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
     * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
     * after this event was fired, in order to ensure they weren't added to homebridge already.
     * This event can also be used to start discovery of new accessories.
     */
    api.on(APIEvent.DID_FINISH_LAUNCHING, async () => {
      log.info("Cache restored.");

      log.info("Loading switch data");

      let switches;
      // grab available switches
      try {
        switches = await axios.get(this.configURL);
      } catch (exception) {
        log.error("Failed to access server!");
        return;
      }

      const registeredSwitches = this.accessories.map((accessory: PlatformAccessory) => accessory.context.action);
      const switchData    = switches.data.data;
      const switchActions = _.keys(switchData);

      const switchesToRemove = _.difference(registeredSwitches, switchActions);
      const switchesToAdd    = _.difference(switchActions, registeredSwitches);

      if (switchesToRemove) {
        log.info("Removing switches: " + switchesToRemove.join(", "));
        switchesToRemove.forEach(action => this.removeAccessory(action));
      } else {
        log.info("No switches to remove");
      }

      if (switchesToAdd) {
        log.info("Adding switches: " + switchesToAdd.join(", "));
        switchesToAdd.forEach(action => this.addAccessory(switchData[action], action));
      } else {
        log.info("No switches to add");
      }
    });
  }

  /*
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log("Configuring accessory %s", accessory.displayName);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log("%s identified!", accessory.displayName);
    });

    accessory.getService(hap.Service.Switch)!.getCharacteristic(hap.Characteristic.On)
             .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
               this.log.info(accessory.displayName + " was triggered.");
               callback();

               setTimeout(() => {
                 this.log.info(accessory.displayName + ": updating button value to false.");
                 accessory.getService(hap.Service.Switch)!.getCharacteristic(hap.Characteristic.On).updateValue(false);
               }, 3000);

               let response;
               try {
                 response = await axios.post(accessory.context.actionUrl);
               } catch (exception) {
                 this.log.error("Failed to trigger request for " + accessory.displayName);
                 return;
               }

               if (response.data.status === "ok") {
                this.log.info(accessory.displayName + " triggered successfully!");
               } else {
                 this.log.error("Failed to trigger: " + accessory.displayName + "! Please check server!");
               }
             });

    this.accessories.push(accessory);
  }

  addAccessory(name: string, action: string) {
    this.log.info("Adding new accessory with name %s", name);

    const uuid      = hap.uuid.generate(name);
    const accessory = new Accessory(name, uuid);

    accessory.addService(hap.Service.Switch, name);
    accessory.context.action    = action;
    accessory.context.actionUrl = this.configURL + action;

    this.configureAccessory(accessory); // abusing the configureAccessory here

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  removeAccessory(action: string) {
    this.log.info("Removing accessory with action %s", action);

    const accessoryToRemove = this.accessories.filter(accessory => accessory.context.action === action);

    if (accessoryToRemove.length === 0) {
      this.log.error("Unable to remove accessory " + action + "! Does not exist.");
      return;
    }

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoryToRemove);
  }

  removeAccessories() {
    this.log.info("Removing all accessories");

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
    this.accessories.splice(0, this.accessories.length); // clear out the array
  }
}

# Wearable health-data integration

## Supported trust boundary

MediTrack accepts health readings through three explicitly separated routes:

1. **Health Connect**: the Android app reads only user-approved records. Permission
   alone is not proof of integration. A sync with records is
   `HEALTH_CONNECT_AVAILABLE`; a successful read with zero records is
   `HEALTH_CONNECT_NO_RECORDS`.
2. **Standard Bluetooth LE**: a device is compatible only after a successful
   GATT connection discovers Heart Rate Service `0x180D` and Heart Rate
   Measurement `0x2A37`. Advertising a health-related appearance is not enough.
3. **Manual entry**: user-measured readings are stored as `MANUAL` and
   `USER_REPORTED`. They are never promoted to verified device telemetry.

Devices that expose only proprietary services remain unsupported unless the
manufacturer supplies an official, licensed SDK or API.

## Noise Halo 2 Mod investigation

The tested Halo 2 Mod was visible at approximately -45 to -60 dBm and advertised
the proprietary service `0x3802`. It did not advertise standard Heart Rate
Service `0x180D`, and `0x2A37` was not discovered. Generic GATT connection
attempts repeatedly failed with Android status 147 (`0x93`, connection timeout).

Health Connect permissions were correctly divided: NoiseFit could write and
MediTrack could read. However, Health Connect contained zero heart-rate records.
This proves permission configuration worked, but NoiseFit did not provide a
usable data bridge for this watch.

The production conclusion is `PROPRIETARY_WATCH_UNSUPPORTED`. MediTrack must not
guess packet formats, write arbitrary values to `0x3802`, or label typed values
as watch readings.

## Diagnostic contract

Safe diagnostics may include:

- selected route;
- integration state;
- Health Connect record count;
- denied Health Connect type count;
- advertised and discovered service UUIDs;
- BLE connection status;
- GATT error code;
- unsupported reason;
- processing duration.

Logs must not include heart rate, oxygen saturation, blood pressure, glucose, or
other health values. Android Health Connect diagnostics use the
`MediTrackWearable` Logcat tag.

## Current implementation boundary

- Health Connect record import is implemented.
- The server validates and labels manual, simulated, unverified, and Health
  Connect provenance separately.
- The production dashboard hides the development-only BLE simulator.
- A deterministic BLE compatibility classifier exists for future native
  discovery.
- A native standard-BLE scanner/subscriber is not yet implemented. It may only
  accept devices that successfully expose both `0x180D` and `0x2A37`.
- Halo 2 automatic import requires an official Noise/FitCloud SDK or API.

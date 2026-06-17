# device-farm-ios — ws-scrcpy fork (iOS 26 restoration)

> Fork of [NetrisTV/ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy) that restores
> its experimental **iOS** support on current macOS / **iOS 26**.
>
> ⚠️ **The iOS changes live on the [`fix/restore-ios-support`](https://github.com/HikariSenshi/device-farm-ios/tree/fix/restore-ios-support) branch — `git checkout fix/restore-ios-support` after cloning (`master` is not updated yet).**

## Why this fork exists

ws-scrcpy has experimental iOS screen mirroring, but on a modern Mac it was
effectively broken: the video bridge it spawns ([ws-qvh](https://github.com/NetrisTV/ws-qvh))
was built against a 2020 dependency snapshot whose `gousb v2.1.0+incompatible`
panics (`libusb: unknown error [code -99]`), and a WebDriverAgent (touch-control)
failure would crash the whole server. The result was a silent
`[StreamReceiver] WS closed` with no obvious cause.

This fork — together with the rebuilt
[ws-qvh-renovation](https://github.com/HikariSenshi/ws-qvh-renovation) bridge — gets
iOS video streaming working again on **iOS 26.5 / Apple Silicon macOS**, with
multiple devices at once.

## What this fork changes (server-side, `src/server/appl-device/`)

- **A WebDriverAgent failure no longer crashes the server.** `WebDriverAgentProxy`
  now handles the `WdaRunner` `error` event — the unhandled `emit('error')` used to
  take down the whole Node process when WDA's `xcodebuild` failed.
- **Configurable WDA code signing** via env (`WDA_TEAM_ID` / `WDA_SIGNING_ID` /
  `WDA_BUNDLE_ID` / `WDA_USE_PREBUILT`) instead of hardcoded capabilities — needed to
  sign WebDriverAgent for a real device.
- **`WS_SCRCPY_DEBUG`** surfaces ws-qvh's own logs (device discovery, QuickTime
  activation, `PING received`, libusb errors) and the QVH proxy wiring into the
  server console (off by default).

## Requires

The rebuilt video bridge on `PATH`:
**[ws-qvh-renovation](https://github.com/HikariSenshi/ws-qvh-renovation)** (upstream
ws-qvh does not build on modern macOS). Build it, put `ws-qvh` on `PATH`, then run
ws-scrcpy with `INCLUDE_APPL` enabled.

## Status

- **Video:** works (qvh → ws-qvh → ws-scrcpy), multi-device, iOS 26.5.
- **Device control (WebDriverAgent):** in progress — migrating the in-process
  `appium-xcuitest-driver@3.62` (2021) to a modern Appium server, since the current
  driver dropped the embedding API this code relied on.

---

*Original upstream README follows.*

# ws scrcpy

Web client for [Genymobile/scrcpy][scrcpy] and more.

## Requirements

Browser must support the following technologies:
* WebSockets
* Media Source Extensions and h264 decoding;
* WebWorkers
* WebAssembly

Server:
* Node.js v10+
* node-gyp ([installation](https://github.com/nodejs/node-gyp#installation))
* `adb` executable must be available in the PATH environment variable

Device:
* Android 5.0+ (API 21+)
* Enabled [adb debugging](https://developer.android.com/studio/command-line/adb.html#Enabling)
* On some devices, you also need to enable
[an additional option](https://github.com/Genymobile/scrcpy/issues/70#issuecomment-373286323)
to control it using keyboard and mouse.

## Build and Start

Make sure you have installed [node.js](https://nodejs.org/en/download/),
[node-gyp](https://github.com/nodejs/node-gyp) and
[build tools](https://github.com/nodejs/node-gyp#installation)
```shell
git clone https://github.com/NetrisTV/ws-scrcpy.git
cd ws-scrcpy

## For stable version find latest tag and switch to it:
# git tag -l
# git checkout vX.Y.Z

npm install
npm start
```

## Supported features

### Android

#### Screen casting
The modified [version][fork] of [Genymobile/scrcpy][scrcpy] used to stream
H264-video, which then decoded by one of included decoders:

##### Mse Player

Based on [xevokk/h264-converter][xevokk/h264-converter].
HTML5 Video.<br>
Requires [Media Source API][MSE] and `video/mp4; codecs="avc1.42E01E"`
[support][isTypeSupported]. Creates mp4 containers from NALU, received from a
device, then feeds them to [MediaSource][MediaSource]. In theory, it can use
hardware acceleration.

##### Broadway Player

Based on [mbebenita/Broadway][broadway] and
[131/h264-live-player][h264-live-player].<br>
Software video-decoder compiled into wasm-module.
Requires [WebAssembly][wasm] and preferably [WebGL][webgl] support.

##### TinyH264 Player

Based on [udevbe/tinyh264][tinyh264].<br>
Software video-decoder compiled into wasm-module. A slightly updated version of
[mbebenita/Broadway][broadway].
Requires [WebAssembly][wasm], [WebWorkers][workers], [WebGL][webgl] support.

##### WebCodecs Player

Decoding is done by browser built-in (software/hardware) media decoder.
Requires [WebCodecs][webcodecs] support. At the moment, available only in
[Chromium](https://www.chromestatus.com/feature/5669293909868544) and derivatives.

#### Remote control
* Touch events (including multi-touch)
* Multi-touch emulation: <kbd>CTRL</kbd> to start with center at the center of
the screen, <kbd>SHIFT</kbd> + <kbd>CTRL</kbd> to start with center at the
current point
* Mouse wheel and touchpad vertical/horizontal scrolling
* Capturing keyboard events
* Injecting text (ASCII only)
* Copy to/from device clipboard
* Device "rotation"

#### File push
Drag & drop an APK file to push it to the `/data/local/tmp` directory. You can
install it manually from the included [xtermjs/xterm.js][xterm.js] terminal
emulator (see below).

#### Remote shell
Control your device from `adb shell` in your browser.

#### Debug WebPages/WebView
[/docs/Devtools.md](/docs/Devtools.md)

#### File listing
* List files
* Upload files by drag & drop
* Download files

### iOS

***Experimental Feature***: *is not built by default*
(see [custom build](#custom-build))

#### Screen Casting

Requires [ws-qvh][ws-qvh] available in `PATH`.

#### MJPEG Server

Enable `USE_WDA_MJPEG_SERVER` in the build configuration file
(see [custom build](#custom-build)).

Alternative way to stream screen content. It does not
require additional software as `ws-qvh`, but may require more resources as each
frame encoded as jpeg image.

#### Remote control

To control device we use [appium/WebDriverAgent][WebDriverAgent].
Functionality limited to:
* Simple touch
* Scroll
* Home button click

Make sure you did properly [setup WebDriverAgent](https://appium.io/docs/en/drivers/ios-xcuitest-real-devices/).
WebDriverAgent project is located under `node_modules/appium-webdriveragent/`.

You might want to enable `AssistiveTouch` on your device: `Settings/General/Accessibility`.

## Custom Build

You can customize project before build by overriding the
[default configuration](/webpack/default.build.config.json) in
[build.config.override.json](/build.config.override.json):
* `INCLUDE_APPL` - include code for iOS device tracking and control
* `INCLUDE_GOOG` - include code for Android device tracking and control
* `INCLUDE_ADB_SHELL` - [remote shell](#remote-shell) for android devices
([xtermjs/xterm.js][xterm.js], [Tyriar/node-pty][node-pty])
* `INCLUDE_DEV_TOOLS` - [dev tools](#debug-webpageswebview) for web pages and
web views on android devices
* `INCLUDE_FILE_LISTING` - minimalistic [file management](#file-listing)
* `USE_BROADWAY` - include [Broadway Player](#broadway-player)
* `USE_H264_CONVERTER` - include [Mse Player](#mse-player)
* `USE_TINY_H264` - include [TinyH264 Player](#tinyh264-player)
* `USE_WEBCODECS` - include [WebCodecs Player](#webcodecs-player)
* `USE_WDA_MJPEG_SERVER` - configure WebDriverAgent to start MJPEG server
* `USE_QVH_SERVER` - include support for [ws-qvh][ws-qvh]
* `SCRCPY_LISTENS_ON_ALL_INTERFACES` - WebSocket server in `scrcpy-server.jar`
will listen for connections on all available interfaces. When `true`, it allows
connecting to device directly from a browser. Otherwise, the connection must be
established over adb.

## Run configuration

You can specify a path to a configuration file in `WS_SCRCPY_CONFIG`
environment variable.

If you want to have another pathname than "/" you can specify it in the
`WS_SCRCPY_PATHNAME` environment variable.

Configuration file format: [Configuration.d.ts](/src/types/Configuration.d.ts).

Configuration file example: [config.example.yaml](/config.example.yaml).

## Known issues

* The server on the Android Emulator listens on the internal interface and not
available from the outside. Select `proxy over adb` from the interfaces list.
* TinyH264Player may fail to start, try to reload the page.
* MsePlayer reports too many dropped frames in quality statistics: needs
further investigation.
* On Safari file upload does not show progress (it works in one piece).

## Security warning
Be advised and keep in mind:
* There is no encryption between browser and node.js server (you can [configure](#run-configuration) HTTPS).
* There is no encryption between browser and WebSocket server on android device.
* There is no authorization on any level.
* The modified version of scrcpy with integrated WebSocket server is listening
for connections on all network interfaces (see [custom build](#custom-build)).
* The modified version of scrcpy will keep running after the last client
disconnected.

## Related projects
* [Genymobile/scrcpy][scrcpy]
* [xevokk/h264-converter][xevokk/h264-converter]
* [131/h264-live-player][h264-live-player]
* [mbebenita/Broadway][broadway]
* [DeviceFarmer/adbkit][adbkit]
* [xtermjs/xterm.js][xterm.js]
* [udevbe/tinyh264][tinyh264]
* [danielpaulus/quicktime_video_hack][qvh]

## scrcpy websocket fork

Currently, support of WebSocket protocol added to v1.19 of scrcpy
* [Prebuilt package](/vendor/Genymobile/scrcpy/scrcpy-server.jar)
* [Source code][fork]

[fork]: https://github.com/NetrisTV/scrcpy/tree/feature/websocket-v1.19.x

[scrcpy]: https://github.com/Genymobile/scrcpy
[xevokk/h264-converter]: https://github.com/xevokk/h264-converter
[h264-live-player]: https://github.com/131/h264-live-player
[broadway]: https://github.com/mbebenita/Broadway
[adbkit]: https://github.com/DeviceFarmer/adbkit
[xterm.js]: https://github.com/xtermjs/xterm.js
[tinyh264]: https://github.com/udevbe/tinyh264
[node-pty]: https://github.com/Tyriar/node-pty
[WebDriverAgent]: https://github.com/appium/WebDriverAgent
[qvh]: https://github.com/danielpaulus/quicktime_video_hack
[ws-qvh]: https://github.com/NetrisTV/ws-qvh

[MSE]: https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API
[isTypeSupported]: https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/isTypeSupported
[MediaSource]: https://developer.mozilla.org/en-US/docs/Web/API/MediaSource
[wasm]: https://developer.mozilla.org/en-US/docs/WebAssembly
[webgl]: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
[workers]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
[webcodecs]: https://w3c.github.io/webcodecs/

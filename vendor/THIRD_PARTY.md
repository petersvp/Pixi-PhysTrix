# Vendored browser libraries

These files are served directly by the local CDN emulator and imported by the
browser through the import map in `index.html`. Runtime browser code must not
import from `node_modules` and must not require a bundler.

## Discord Embedded App SDK

- Source package: `@discord/embedded-app-sdk` 2.5.0
- Vendored entry point: `discord-embedded-app-sdk/index.mjs`
- License: MIT, included in that directory.
- The complete compiled `output/` dependency tree is retained because its ESM
  modules import one another by relative URL.

## FlatBuffers JavaScript runtime

- Source package: `flatbuffers` 25.9.23
- Vendored entry point: `flatbuffers/flatbuffers.js`
- License: Apache-2.0, included in that directory.
- Generated PhysTrix FlatBuffer modules should import this runtime through the
  `flatbuffers` import-map alias.

The installed packages may be used only to refresh these reviewed vendor files.
They are not a browser runtime dependency.

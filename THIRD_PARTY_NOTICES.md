# Third-party notices

## Dart Tree-sitter WASM grammar

- Package: `@lumis-sh/wasm-dart@0.26.3`
- License: MIT
- SHA-256: `f743e6ecda0447cf330d012e9c8dc4f784d2a8874dbdec4b929b0dde87faec79`
- Source: <https://github.com/leandrocp/lumis>

The package's `LICENSE` file is included in the packaged production dependency.
The extension verifies the WASM artifact checksum before loading it.

## WebP encoder/decoder (WASM)

- Packages: `@jsquash/webp@1.5.0` (Apache-2.0, repackaged from the Squoosh codecs, which embed Google's libwebp under the BSD-3-Clause license) and its dependency `wasm-feature-detect@1.9.0` (Apache-2.0)
- Source: <https://github.com/jamsinclair/jSquash>

Used by `scripts/convert-images-to-webp.js` to convert PNG/JPEG assets to WebP. Each package's `LICENSE` file is included in the packaged production dependency.

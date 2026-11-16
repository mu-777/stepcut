# Third-party notices

StepCut
Copyright 2026 mu-777

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

This product includes the third-party software listed below. Each component is
distributed under its own license, reproduced or referenced in this file.

## Bundled components

| Component | Version | License | Copyright | Source |
|---|---|---|---|---|
| Electron | 45.1.0 | MIT | Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc. | https://github.com/electron/electron |
| Chromium (inside Electron) | — | BSD-3-Clause and others | The Chromium Authors and others | See `LICENSES.chromium.html` shipped next to the executable |
| Mediabunny | 1.63.0 | MPL-2.0 | Vanilagy | https://github.com/Vanilagy/mediabunny |
| React | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/facebook/react |
| React DOM | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/facebook/react |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/facebook/react |
| Zod | 4.6.7 | MIT | Copyright (c) 2025 Colin McDonnell | https://github.com/colinhacks/zod |
| @types/dom-webcodecs | 0.1.13 | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/dom-mediacapture-transform | 0.1.12 | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |

Electron's own license is also shipped as `LICENSE.electron.txt` next to the executable.

## Mediabunny (MPL-2.0)

Mediabunny is used without modification. Its Source Code Form is available at
https://github.com/Vanilagy/mediabunny (version 1.63.0, npm package `mediabunny`).
The full text of the Mozilla Public License 2.0 is available at
https://mozilla.org/MPL/2.0/ and in `node_modules/mediabunny/LICENSE` of the source tree.

## MIT License

The following text applies to every component above marked "MIT", with the
copyright line given in the table.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Not bundled

These are used by StepCut only when the user sets them up, and are not distributed with it:
the OS speech synthesizer (Windows `Windows.Media.SpeechSynthesis`, macOS `say`),
VOICEVOX-compatible engines, and Azure AI Speech. Their own terms apply.

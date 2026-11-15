# Abyssal Space verification

Verified 2026-11-15 on Windows using headless Chrome 157.0.8103.51 with hardware WebGPU. The adapter reports NVIDIA, Turing architecture; Chrome does not expose its exact device model. These measurements describe this machine and browser session.

## Deliverable

- `index.html`: **47,388 bytes (46.3 KiB)**, approximately **19.1 KiB gzip**.
- Self-contained production HTML, opened directly from `file:///`.
- No downloaded textures, models, sounds, fonts or runtime JavaScript libraries.
- Separate readable `dev.html` for diagnostics; development hooks are absent from production.
- Build commands: `npm run build` and `npm run build:dev` from `source/`.

## Functional checks

`tools/check_scene.py` completed successfully at all three quality levels, checking:

- Compilation and execution of the actual WGSL pipelines.
- Zero WebGPU adapter requests, untouched canvas dimensions and no generated world while waiting on the welcome screen.
- Pre-start quality changes keep generation gated and select the correct MSAA count (4x for High/Medium, 1x for Low).
- Starting layout covers both sides of the central sun in a nearly coplanar ecliptic, rather than clustered below it.
- Three distant world instances remain fixed outside the local orbital update; no additional destination buttons are added.
- Launch, WASD movement, mute and return to the menu.
- All seven destination shortcuts, the Abyssal Space title, this repository's GitHub link and the linked Abyssal Garden footer credit.
- Web Audio initialization, cruise-drive state, warp-charge state, and silent propulsion during orbital tracking.
- Seven swept collision tests: six worlds and the black hole's horizon.
- 421 orbital configurations spanning 4,200 simulated seconds, checking parent-relative radii and separation between worlds.
- Actual orbital motion over elapsed browser time and constant camera offset while following a destination.
- 601 samples of the scripted route remaining outside planet collision boundaries.
- Loading and launching the minified production file from disk.
- No JavaScript exceptions, console errors or WebGPU validation errors.

| Quality | Asteroid/debris instances | Antialiasing | Result |
|---|---:|---|---|
| High | 8,300 | 4x MSAA | Passed |
| Medium | 4,100 | 4x MSAA | Passed |
| Low | 1,800 | None | Passed |

The viewport was 2560 x 1440. High and Medium began rendering at that resolution. Low began at 942 x 530 and increased its resolution as the adaptive controller measured available headroom. Low uses coarser meshes and fewer noise octaves.

The High-detail overview, destination captures, welcome screen and pause menu were visually inspected. The overview includes the sun-centered orbital guides, distant giant worlds and a procedural spiral galaxy. Nadir uses an analytic horizon and animated accretion disk, plus depth-aware screen-space lensing of the rendered background. Its shader is limited to a projected bounding quad. Updated overview, Verdant, Nadir and welcome captures are included in `.github/screenshots/`; the full local set is in the ignored `.checks/` directory.

## 60-second flight

High detail, fixed **2560 x 1440**, **3,600 frames**:

| Measurement | Average | 99th percentile | Maximum |
|---|---:|---:|---:|
| Animation-frame interval | 16.67 ms | 16.80 ms | 16.90 ms |
| GPU render time | 4.44 ms | 6.84 ms | 7.79 ms |

GPU timestamps span the scene and postprocessing passes. The development logger records the latest available GPU result each frame. The browser paced animation frames at approximately 60 Hz. This is not a 180 Hz presentation test; the maximum animation-frame interval exceeds a strict 16.7 ms ceiling. Adaptive resolution is disabled during the benchmark; normal exploration adjusts resolution when GPU load is high.

Raw benchmark text is retained in `.checks/benchmark-q0.txt`. Reproduce with:

```sh
python tools/check_scene.py --screenshots --benchmark
python tools/check_scene.py --quality 1
python tools/check_scene.py --quality 2 --screenshots
```

## Limits

Physical touchscreen devices and interactive pointer-lock mouse behavior were not tested. Browser automation checked keyboard movement and menu transitions; touch controls retain the existing experimental interaction model. Visual review used captured frames rather than a motion recording or an independent reviewer. The original RTX 5070 Ti / 180 Hz hardware target was unavailable, so no claim is made about its performance.

The primary worlds follow separated circular orbits around the sun, with Selene orbiting Aurelia. Periods and distances are compressed; this is not an N-body or general-relativity solver. Lensing is a visual approximation. Landable terrain, asteroid collisions and planet-to-planet eclipses are not simulated. Audio validation checked the live graph and propulsion controls; perceptual listening on physical speakers/headphones was not part of browser automation.

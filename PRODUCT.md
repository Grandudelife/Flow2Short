# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static offline-first HTML/CSS/JavaScript PWA with a browser-based FFmpeg WebAssembly renderer. The user selected a hybrid approach: full rendering is optimized for Mac and Windows; iPhone supports the same project interface and best-effort rendering, with project export for finishing on desktop when mobile memory is insufficient.

## Users

Primary user: Mohammad, producing daily English YouTube Shorts from Google Flow clips. He needs a visual workflow and does not want to edit configuration files or type terminal commands.

## Product Purpose

Flow2Short Studio turns multiple Google Flow clips into a publishable vertical short through one visual workspace. Success means importing clips, arranging and trimming them, choosing the retained source-audio percentage per clip, adding narration/music/captions, and exporting an MP4 without learning a professional editor.

## Positioning

Unlike a general-purpose editor, Flow2Short Studio makes the repeated AI-short workflow explicit: each clip carries its own retained Flow-audio percentage while narration, music, captions, order, trim, and vertical export are managed as one compact recipe.

## Operating Context

- Input clips are typically vertical Google Flow MP4 videos.
- Narration can be synthesized in Flow2Short with Google Gemini TTS and one saved API key, or imported from a local audio file.
- The final target is an English YouTube Short around 50–60 seconds.
- The user works mainly on a MacBook and may also use Windows or an iPhone.
- The app must remain useful offline after its assets are installed or cached.

## Capabilities and Constraints

- Import, reorder, preview, trim, and remove multiple clips.
- Set original Flow audio from 0–100% independently for each clip.
- Add narration and optional background music with independent volume controls.
- Add or import SRT captions.
- Preview the complete cut with synchronized source audio, narration, music and captions before rendering.
- Choose from production-ready caption presets and tune size, color and vertical placement.
- Save/import a lightweight project recipe.
- Render MP4 locally in the browser where memory permits.
- Browser video rendering is expected to be slower than native FFmpeg.
- iPhone memory may be insufficient for several 1080×1920 clips; the UI must preserve the project and explain the desktop continuation path rather than fail silently.
- No uploaded media should leave the device.

## Brand Commitments

- Product name: Flow2Short Studio.
- Persian, right-to-left interface using Vazirmatn.
- Modern, polished, app-like UI with restrained purposeful motion.
- The workflow should feel simpler than CapCut for this narrow use case.

## Evidence on Hand

- Existing tested Flow2Short shell automation in the workspace proves the timeline, per-clip source-audio volume, narration, music, caption, and export model.
- Real user media is not bundled and must not be fabricated.

## Product Principles

- Keep editing decisions visible and reversible.
- Never hide what will happen to original clip audio.
- Prefer a reliable hard cut over decorative transitions.
- Keep all media local to the user’s device.
- Degrade gracefully on memory-limited devices.

## Accessibility & Inclusion

- Full keyboard navigation on desktop.
- Touch targets suitable for iPhone.
- High-contrast controls, visible focus states, reduced-motion support, and status updates exposed to assistive technology.

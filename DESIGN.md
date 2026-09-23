---
name: Flow2Short Studio
description: A calm, visible recipe for assembling AI-generated shorts.
colors:
  action-emerald: "#057e56"
  action-emerald-deep: "#046946"
  action-emerald-soft: "#e9f7f1"
  audio-coral: "#f36a70"
  audio-coral-soft: "#fff0f0"
  ink-navy: "#10213c"
  ink-secondary: "#253650"
  text-muted: "#65748a"
  canvas-cool: "#f4f6f4"
  surface-white: "#ffffff"
  border-cool: "#dce3e6"
typography:
  headline:
    fontFamily: "Vazirmatn, system-ui, sans-serif"
    fontSize: "clamp(1.375rem, 2.2vw, 1.875rem)"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Vazirmatn, system-ui, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Vazirmatn, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Vazirmatn, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  control: "10px"
  panel: "14px"
  section: "18px"
  dialog: "20px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "26px"
components:
  button-primary:
    backgroundColor: "{colors.action-emerald}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.panel}"
    padding: "12px 20px"
    height: "54px"
  button-primary-hover:
    backgroundColor: "{colors.action-emerald-deep}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.panel}"
  input:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "43px"
  work-section:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.section}"
    padding: "26px"
---

# Design System: Flow2Short Studio

## Overview

**Creative North Star: "The Visible Recipe"**

Flow2Short Studio behaves like a focused production recipe laid open on a clean worktable. Every consequential decision—clip order, trim points and retained source audio—stays attached to the media it affects. The interface is calm and compact, but never cryptic: brand expression comes from exact spacing, decisive ink-navy type, emerald actions and a restrained coral audio accent.

The system is operational rather than promotional. It prioritizes scanability, reversible choices and confidence during a potentially long local render. Motion is used to show reordering, state and progress; it is not decorative.

**Key Characteristics:**

- Persian-first RTL composition with left-to-right treatment only for filenames and technical values.
- Cool white surfaces, fine neutral rules and restrained ambient elevation.
- Emerald identifies progress and primary actions; coral belongs to background music.
- Dense enough to show the full recipe, spacious enough to prevent editor fatigue.

## Colors

The palette is a cool operational neutral field with one trustworthy green action voice and one bounded coral audio voice.

### Primary

- **Action Emerald:** the primary render action, active workflow state, ranges and success feedback.
- **Deep Emerald:** accessible hover states and dark green text on pale green surfaces.
- **Soft Emerald:** selected navigation, privacy status and narration surfaces.

### Secondary

- **Audio Coral:** music waveform and music-specific controls only.
- **Soft Coral:** music panel and related secondary action surfaces.

### Neutral

- **Ink Navy:** headings, core controls and the preview stage.
- **Secondary Ink:** supporting labels and outline icons.
- **Cool Canvas:** the app field behind white work sections.
- **White Surface:** sections, cards, dialogs and the fixed render bar.
- **Cool Border:** dividers, fields and resting card boundaries.

**The Two Voices Rule.** Emerald carries action and progress; coral carries music. Do not introduce another saturated control color.

## Typography

**Display Font:** Vazirmatn with system sans fallback

**Body Font:** Vazirmatn with system sans fallback

**Technical Text:** the platform UI sans stack for Latin filenames and measurements

**Character:** Vazirmatn keeps Persian instructions compact and contemporary without losing warmth. Weight, size and placement—not multiple typefaces—create hierarchy.

### Hierarchy

- **Headline** (700, fluid 22–30px, 1.35): the current editing task.
- **Title** (700, 21px, 1.35): major workflow sections and dialogs.
- **Body** (400, 15px, 1.55): instructions and explanations.
- **Label** (600, 12px, 1.5): controls, metadata and compact status.

**The Direction Rule.** Persian copy remains RTL; filenames, extensions, time values and dimensions receive explicit LTR direction without flipping their parent layout.

## Layout

Desktop uses a fixed 72px header, a 224px workflow rail on the right and a centered work column capped near 1060px. The fixed render bar anchors the bottom and summarizes total duration, clip count and output size. Sections use a 20–26px internal rhythm; tightly related controls remain within 6–14px.

Below 820px the right rail becomes a horizontal 58px step bar, work sections collapse to one column and the render bar keeps only the essential summary and action. Clip cards reflow from five desktop columns to a two-row mobile arrangement while retaining the audio range with the clip.

## Elevation & Depth

Depth is ambient and restrained. Sections use a wide, low-opacity navy shadow; the fixed header and render bar use directional shadows. Borders define most resting components. Hover elevation appears only on interactive clip cards and primary controls.

### Shadow Vocabulary

- **Work Surface:** `0 8px 22px rgba(16, 33, 60, 0.06)` for major white sections and hover cards.
- **Floating Layer:** `0 16px 40px rgba(16, 33, 60, 0.08)` for toasts and elevated utilities.
- **Dialog:** `0 28px 80px rgba(16, 33, 60, 0.24)` for protected-focus tasks.

**The Border-First Rule.** Resting controls use a one-pixel cool border; elevation is reserved for movement, fixed layers and protected focus.

## Shapes

Controls use gently rounded 10px corners, cards and media panels use 14px, sections use 18px and dialogs use 20px. Pills are reserved for compact statuses such as offline/private. Circular geometry is limited to icon wells, range thumbs and the render progress indicator.

## Brand Mark

The mark is a single, rounded path shaped like a compact 2: a long white input flows through one decisive turn and ends as a short emerald output. It expresses the product promise without a literal camera, clapperboard or play-button badge. The navy squircle is the canonical app-icon field; the same two-stroke geometry appears in the header. Keep the silhouette flat, gradient-free and legible at favicon size. Do not add secondary symbols, outlines or the coral audio accent to the mark.

## Components

### Buttons

- **Shape:** confident rounded rectangle (12–14px).
- **Primary:** emerald surface, white 700-weight label and 54px height.
- **Hover / Focus:** darken to deep emerald, rise by one pixel and show a visible three-pixel focus ring.
- **Quiet:** ink text on a cool neutral fill; no border and no saturated hover.

### Cards / Containers

- **Corner Style:** 14px for clip and media units; 18px for workflow sections.
- **Background:** white for editing units, pale emerald for narration and pale coral for music.
- **Shadow Strategy:** flat at rest; ambient lift on hover or protected layers.
- **Border:** one-pixel cool rule where card boundaries must remain visible.
- **Internal Padding:** 12–18px for units, 26px for desktop sections.

### Inputs / Fields

- **Style:** 43px high, white or near-white field, 10px radius and one-pixel cool border.
- **Focus:** emerald border plus a translucent three-pixel focus ring.
- **Technical Values:** tabular numerals and explicit LTR direction.

### Navigation

The desktop step rail uses a circular icon well and two lines of copy. The active step receives a pale emerald field and filled emerald icon; no decorative side stripe. On mobile it becomes a compact horizontal bar with icons and one-line labels.

### Clip Recipe Card

The signature card binds the thumbnail, filename, trim inputs, source-audio range and reordering actions into one unit. Desktop keeps these decisions on one line; mobile preserves association by moving the audio range to a second row inside the same card.

### Mix Preview

The fast preview is a protected-focus vertical player opened from the persistent render bar. It plays trimmed clips in order and keeps source audio, narration, looping music and SRT cues synchronized on a single global clock. Its transport is intentionally compact: play/pause, current time, total time and seek. Preview remains available in direct-file mode because it does not invoke FFmpeg; final rendering remains disabled there.

### Caption Studio

Caption styling stays inline with the caption step rather than becoming a separate editor. Six presets—Impact, Clean, Boxed, Mint, Neon and Minimal—share one preview stage and three explicit controls: size, vertical position and primary color. The selected style is applied both to the browser preview and the FFmpeg subtitle filter. Presets may use neutral or emerald treatments; coral remains reserved for music.

## Do's and Don'ts

### Do:

- **Do** keep every audio percentage visually attached to its source.
- **Do** use outline SVG icons with one consistent stroke weight.
- **Do** keep primary render progress and privacy states in the emerald family.
- **Do** keep the final render action reachable on every viewport.

### Don't:

- **Don't** introduce timeline-editor complexity or hidden per-clip settings.
- **Don't** use coral for success, navigation or primary actions.
- **Don't** add decorative gradients, glass cards or colored side stripes.
- **Don't** allow generated text or technical filenames to inherit the wrong direction.

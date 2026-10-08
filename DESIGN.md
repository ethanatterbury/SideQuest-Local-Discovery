---
name: SideQuest
description: An editorial decision surface for a considered local detour.
colors:
  paper: "#f6f6ef"
  surface: "#fff"
  ink: "#243b30"
  muted: "#647064"
  accent: "#d9eb84"
  line: "#dce0d5"
  ink-hover: "#36543f"
  accent-hover: "#cadd71"
  secondary-line: "#b9c2ae"
  secondary-hover: "#e9eddf"
  focus: "#537a3c"
  panel: "#e7ecda"
typography:
  display:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "clamp(38px, 3.85vw, 54px)"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "23px"
    fontWeight: 550
  body:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "12px"
  button:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "15px"
    fontWeight: 500
rounded:
  badge: "4px"
  field: "5px"
  search: "6px"
  button: "7px"
  control: "8px"
  image: "10px"
  panel: "12px"
  sheet: "14px"
  dialog: "16px"
  circle: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  section: "32px"
  wide: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "13px 24px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "13px 24px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  button-escape:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "16px 24px"
  button-escape-hover:
    backgroundColor: "{colors.accent-hover}"
  button-icon:
    rounded: "{rounded.circle}"
    width: "44px"
    height: "44px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "12px"
  navigation:
    textColor: "{colors.muted}"
    height: "90px"
  collection-tab:
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 16px"
  collection-tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  place-card:
    textColor: "{colors.ink}"
    rounded: "{rounded.image}"
  refinement:
    rounded: "{rounded.control}"
    padding: "0 3px"
  signature:
    rounded: "{rounded.image}"
    height: "275px"
  action-panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "27px"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "25px"
---

# Design System: SideQuest

## Overview

**Creative North Star: "Editorial decision surface"**

Warm paper, forest ink and real place photography make choosing an outing feel considered and immediate. The interface is calm and practical: tightly tracked headings lead into compact facts, while the yellow-green accent brings one useful action forward. The forked-route mark gives the identity its own shape.

Photographs carry the sense of place. When a photograph is unavailable, the established category illustration and honest fallback label preserve the composition. Motion briefly reveals a decision or acknowledges an interaction; map atmosphere stays behind the controls.

**Key Characteristics:**

- Warm paper and forest ink with a restrained yellow-green action accent.
- Manrope headings paired with DM Sans interface text.
- Open image-led cards, fine dividers and compact practical facts.
- A forked-route mark and one staged SideQuest reveal.
- Responsive task controls with a fixed mobile navigation bar.

This is the implemented visual contract. Frontmatter primitives come from `src/app/globals.css`; font loading and reusable behavior come from the layout, primitives, shell, signature and map-atmosphere sources. It supersedes the provisional radius and reveal-duration descriptions. `.impeccable/design.json` extends these primitives with source-derived states, motion and responsive behavior.

## Colors

The palette feels like pale paper viewed beside a wooded path. Its values live in the frontmatter; contextual gradients and image shades stay in component CSS.

### Primary

- **Forest Ink** (`ink`): primary text, solid buttons, active navigation and selected collection tabs.
- **Fresh Detour** (`accent`): the escape action, saved states and small counts; pair with forest ink.
- **Deep Forest Hover** (`ink-hover`) and **Detour Hover** (`accent-hover`): the corresponding button hover states.

### Neutral

- **Warm Paper** (`paper`): page canvas, dialog surfaces and readable image badges.
- **White Surface** (`surface`): editable fields.
- **Quiet Moss** (`muted`): supporting explanations, category labels and practical metadata.
- **Paper Edge** (`line`): content dividers and field boundaries.
- **Soft Panel** (`panel`): the place action panel.
- **Secondary Edge** (`secondary-line`) and **Secondary Wash** (`secondary-hover`): outlined secondary actions.
- **Focus Leaf** (`focus`): the visible keyboard focus outline and text caret.

**The Legible Accent Rule.** Accent-filled actions use forest ink; forest-filled actions use warm paper.

## Typography

**Display Font:** Manrope Variable, with sans-serif fallback.

**Body Font:** DM Sans Variable, with sans-serif fallback. Both families are bundled through Fontsource imports in the root layout.

The display face is compact and confident; the interface face keeps explanations and controls readable. Sentence case and restrained weight changes make the hierarchy feel editorial.

### Hierarchy

- **Display:** the responsive home heading uses the frontmatter display role. Overrides use 42px at 1150px, 36px at 900px, `clamp(32px, 8.5vw, 46px)` at 700px, 31px at 370px, and 55px above 1550px.
- **Headline:** section headings use the frontmatter headline role; the main section title becomes 22px on mobile.
- **Title:** place-card names use the frontmatter title role; tablet overrides use 21px and 19px.
- **Body:** paragraphs use the frontmatter body role. Mobile body text becomes 14px; introductions and place descriptions may use their source-specific larger roles. Reading-page prose is bounded to 70ch.
- **Label:** supporting interface labels use the compact frontmatter role. Card metadata and badges use 10px; labels stay secondary to the outing name and decision.
- **Brand:** the wordmark uses Manrope at 27px, weight 750 and display tracking; the mobile wordmark uses 25px.

## Layout

The shared desktop content width is `min(1240px, calc(100% - 112px))`. At 1150px and below the horizontal allowance becomes 64px; at 700px it becomes 40px; at 370px it becomes 32px. The header is 90px high on desktop, 78px at 900px, and 72px on mobile; the accompanying context strip is 51px, then 43px on mobile.

Spacing is an observed vocabulary, not an enforced mathematical scale. Repeated 8–40px values sit beside component-specific padding and gaps. Preserve the implemented values rather than rounding every measurement to eight.

The discovery hero uses a `1fr 1.08fr` split with a 52px gap; at 700px it stacks with a 28px gap. Mood choices change from four columns to two; result cards change from three columns to one. Place-detail content pairs a flexible column with a 330px action panel, then stacks on mobile. The map pairs a 355px sidebar with its canvas, changes to 325px at 1150px, and becomes a canvas with a bottom sheet at 700px.

Mobile navigation is fixed to the bottom edge with safe-area padding and a minimum height of 68px. The detail-page action row sits above it. Toasts also clear this navigation. On the map, the collapsed sheet is 245px tall with a 50% maximum; its expanded state reaches 90% of the map. The Environment Lab uses a 700px container query so a narrow preview receives its own compact layout.

## Elevation & Depth

Most content stays flat on the warm-paper canvas. Fine lines separate facts and sections; photography, tonal panels and overlay badges supply depth. Buttons gain the ambient root elevation on hover. Dialogs and mobile map sheets receive stronger structural shadows, and translucent fixed controls use backdrop blur.

The exact shadow strings, dialog backdrop, focus outline, transitions and weather effects are recorded in the sidecar. Do not apply dialog elevation to ordinary result cards.

**The Quiet Surface Rule.** Results remain open on the page; use tonal panels and fine dividers before adding container elevation.

## Shapes

Use the frontmatter radius roles where their corresponding components already establish them. Buttons have a modest curve; fields, collection tabs and grouped refinement controls stay compact and rectangular. Image cards and signature photography use the image role. Desktop hero photography and action panels use the panel role; the hero switches to the image role on mobile. Dialogs use the dialog role on desktop and the sheet role on mobile. The mobile map sheet rounds only its upper corners.

Small match badges use the badge role. Save buttons and icon controls are circular. The forked-route mark uses rounded strokes; preserve it as the brand silhouette.

## Components

### Buttons

Primary actions use forest ink and warm-paper text; the escape variant uses the accent and forest text. The shared minimum height is 49px; the escape action is 55px. Source-specific mobile actions may be smaller. Secondary buttons are transparent with an inset secondary edge. Hover changes the surface and adds ambient elevation; pressing translates the control down 1px. Disabled controls have half opacity and a default cursor. Keyboard focus uses a 2px focus-leaf outline with a 4px offset.

### Chips

Collection tabs are compact rectangular filter controls with the field radius, an outlined resting state and a forest-filled selected state. They wrap when needed. Match badges sit over imagery on warm paper; visited badges use forest ink. The system does not prescribe pill-shaped filters.

### Cards / Containers

Place cards are open content blocks rather than raised boxes. Their visual uses a 1.66 aspect ratio, the image radius, a match badge and circular save action; text starts below with `17px 1px 0` padding. Image hover gently scales the photograph to 1.04 over 500ms. The action panel is tonal with its own panel radius and padding. Dialogs use the paper canvas, stronger shadow and a blurred dark backdrop; the native dialog contains focus and restores the previous focus on close.

### Inputs / Fields

Text and note fields use white surface, a fine paper-edge border, the field radius and a 48px minimum height. Textareas begin at 120px and resize vertically. Search combines its field, icon and submit action in a search-radius container. Grouped refinement controls use the control radius and internal dividers; advanced selects use the field radius. Preserve actual source focus behavior: ordinary fields inherit the global visible outline, while the search input suppresses its outline.

### Navigation

Desktop links sit within the full-height header; the current destination uses forest ink, weight 600 and a bottom rule. Mobile links combine an icon and label in the fixed bottom bar; the active icon thickens and the label gains weight. Keep location and search controls in the header and practical weather context immediately beneath it.

### SideQuest Reveal

The signature pairs a photograph, match badge, name, explanation, practical facts and one leading action. Its image is 275px tall on desktop and 230px on mobile. The entrance runs for 600ms using the root easing curve; the temporary revealing state lasts 500ms, showing facts at half opacity with an 8px offset and clipping the last 6% of the image. Fact opacity and position transition over 400ms. These source timings replace the provisional 420ms description.

### Map Atmosphere

Atmosphere is pointer-free and hidden from assistive technology. Static washes respond to weather, night and the approach to sunset. Overcast, partly cloudy and rain use two soft cloud shadows drifting on independent 38s/53s paths. Fine diagonal rain and snow stay bounded to 12 drops, or 24 for heavy rain; rain adds four sparse surface ripples. Hidden tabs remove drops/ripples and pause cloud/fog animation. Effective reduced motion leaves a static atmosphere and removes particles; the Lab’s explicit Normal preference can override a system reduced-motion preference. Map controls remain above the atmosphere, and marker colors remain readable through its light shading. The signature delay becomes zero when reduced motion is enabled.

## Do's and Don'ts

### Do:

- **Do** pair accent-filled actions with forest ink and forest-filled actions with warm paper.
- **Do** keep outing imagery and practical facts together, including honest image and data fallbacks.
- **Do** use the implemented radius roles and responsive overrides from this record.
- **Do** preserve visible focus, reduced-motion behavior and mobile safe-area spacing.
- **Do** reserve staged reveals for decisions and keep atmosphere behind map controls.

### Don't:

- **Don't** replace the forked-route brand mark with a compass or map pin.
- **Don't** turn open place cards into elevated dashboard panels.
- **Don't** convert rectangular filters and fields into a universal pill shape.
- **Don't** add perpetual decorative movement outside the bounded map atmosphere.
- **Don't** style unknown information as a verified live fact.

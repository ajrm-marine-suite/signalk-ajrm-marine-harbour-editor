# SignalK AJRM Marine Harbour Editor

> **Alpha Release disclaimer:** This software is Alpha Release and has not been tested in live environments and must not be relied upon for navigation or safety. The Authors do not accept any responsibility for loss or damage as a result of using this software.

A small Signal K webapp for creating `regions` resources used by automatic Harbour/Coastal profile switching.

Regions created here are named with the prefix `Harbour:`. Compatible traffic/profile apps can watch those regions and switch to a Harbour profile when own vessel remains inside one, then back to Coastal after leaving.

## Install on a Pi

```bash
cd ~/.signalk
npm install git+https://github.com/ajrm-marine-suite/signalk-ajrm-marine-harbour-editor.git#v0.5.1 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Open the Signal K dashboard, then open **AJRM Marine Harbour Editor** from the app list.

## Use

Version 2 opens as a chart-first editor. The main page shows the chart, saved harbour regions as green dotted limits, and the harbour currently being edited as a thick red dotted preview.

1. Open **Harbours** to select or create a harbour.
2. Enter the harbour name.
3. Choose a radius in nautical miles.
4. Press **New** to show the map-centre crosshair, pan the chart until the crosshair is over the harbour, then press **Make Circle**.
5. Use the arrow buttons and `+` / `-` buttons to move and resize the red preview.
6. Press **Save Region**.

You can also edit the polygon manually. Each line is `latitude, longitude`.

The chart uses a selectable basemap underneath, Auto Charts above it when Signal K chart resources are available, and OpenSeaMap seamarks as a transparent overlay.

## Harbour Data

The app stores harbour regions in local Signal K resources. On a fresh install it seeds the bundled default harbour set only when no existing `Harbour:` regions are present. Subsequent plugin updates do not overwrite local harbour data.

Open **Settings** in the webapp to merge, import, or export harbour data as JSON. Use **Merge** to add harbours from a JSON file that are not already on this Signal K server. Existing local harbours are left untouched. Use **Import** to replace the current `Harbour:` regions with the selected JSON file. Use **Export** to download the current local harbour regions as `harbours.json`. Import and merge actions ask for confirmation first.

## Profile Switching

In the traffic/profile app config, enable automatic harbour profile switching. The default prefix is `Harbour:`.

## Acknowledgements

AJRM Marine Harbour Editor is authored and maintained by Anthony McDonald, with assistance from William McAusland. Development was accelerated with help from OpenAI Codex, especially for code generation, refactoring, and test creation.


## Public Beta

Local harbour region editor for AJRM Marine Suite profiles.

Development assistance: OpenAI Codex helped with code generation, refactoring, and automated testing during the beta development cycle.

# Modular Character Studio

A local-first editor for modular 2D cutout characters. It combines skeletal
animation, layered equipment, profile-specific fitting, hand and wrist
deformation, and equipment previewing in one project format.

The repository starts private while its demo asset pack and portable project
format are validated.

## Run locally

Requires Node.js 24 or newer.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:3010>. The Rig Studio and Equipment Studio share
`project/scene.json`. Saves are revision-checked, written atomically, and backed
up under `project/.history/`.

Set `MCS_PROJECT_ROOT=/absolute/path/to/project` to open another project with
the same layout.

## Bundled demo

The demo contains two body profiles, three armor directions (leather, mage,
and metal), and one sword, axe, staff, bow, and shield. The source code is MIT
licensed. The bundled demo art is CC0; see [ASSETS-LICENSE.md](ASSETS-LICENSE.md).
The retained generation prompts and their output gallery are under
[prompts/](prompts/README.md).

## Project layout

```text
project/
  scene.json
  equipment-catalog.json
  equipment-matrix.json
  assets/
```

The Rig Studio and Equipment Studio are native React routes on TanStack Start.
They share a typed, framework-independent rig core, Zustand editor state, the
same revision-protected project API, and route-scoped canvas-editor styles.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

GoOutside is an app for finding and posting outdoor places in Canada. It's built with Expo SDK 57 and React Native 0.86, using expo-router, TypeScript, and the React Compiler (`experiments.reactCompiler` in `app.json`). Firebase provides Auth, Firestore, Storage and one Cloud Function. The app is mobile only and gets tested in Expo Go on a phone. The repo has no `ios/` or `android/` folders (they're gitignored), no test runner and no Firebase emulator config. Anything that talks to Firebase hits the live project `gooutside-d5f54`.

## Commands

```bash
npm start                      # expo start, for Expo Go
npm run lint                   # expo lint (eslint-config-expo flat config)
npx tsc --noEmit               # typecheck
npm run check:intro            # intro pipeline check, ios + android (~7 s each)
npm run check:intro -- ios     # one platform only
npm --prefix functions run build   # Cloud Functions: separate package, Node 22, own tsconfig
```

- The baseline isn't clean. `tsc` reports about 6 errors, all in unused create-expo-app leftovers (`app-tabs.web.tsx`, `themed-text.tsx`, `themed-view.tsx`, `hint-row.tsx`, `use-theme.ts`), which were written against the starter's theme shape. `lint` reports about 12 react-hooks / React Compiler errors in the app screens. Compare your results against this baseline. Don't fix unrelated files.
- Don't run `npm run reset-project`. It's the starter's script, and it moves `src/` and `scripts/` into `example/`.

## Working rules

- Never put a personal email, password, key or token in a committed file. Read them from env vars, and keep `.env` files out of Git (`.gitignore` already does).

- Never commit or push unless the user asks. When asked, stage files by name (never `git add .` or `git add -A`), and show the user a grouped list of the files before committing.
- Test servers go on port 8082. Never stop or change the user's dev server on 8081.
- For the production-style intro test, set `EXPO_PUBLIC_INTRO_PERF=1` and run `npx expo start --no-dev --minify --port 8082`. That server doesn't watch files, so restart it after every edit. The PC's network address changes between networks, so look up the current one before giving out the `exp://` URL.
- For visual work, verify with rendered frames. Say plainly which results were measured here and which only a real phone can show.
- Give any terminal command the user is meant to run in PowerShell syntax (Windows), e.g. `$env:NAME = 'value'; cmd`, not `NAME=value cmd`.
- Before publishing `firestore.rules`, compare it with the live rules text in the Firebase console. The console had `tasks` and `taskCompletions` rules that the repo's copy lacked, so publishing the repo file unchanged could drop them.

## App structure

- `src/app/` holds the expo-router routes. The root is `_layout.tsx`: it loads the fonts, backfills `users/{uid}` on sign-in, renders `AppTabs` and puts the intro overlay on top. The native tabs are Map (`index`), Discover (`explore`) and Passport (`profile`), defined in `src/components/app-tabs.tsx`. `post`, `login`, `admin`, `explore-canada` and `intro-preview` are also tab routes, hidden with `href: null`. There is no stack navigator.
- `src/lib/firebase.ts` is the only Firebase client (`app`, `auth`, `db`, `storage`), shared by the app and the scripts. Screens query Firestore directly, mostly with `onSnapshot`. There is no data layer.
- `src/constants/theme.ts` holds the "Precision & Parchment" design tokens:
  - `Colors`: one light palette.
  - `Fonts`: loaded in `_layout.tsx`.
  - `Categories`: place category keys, labels and colours. `scripts/seed-test-places.ts` keeps its own hand-written copy of this list.
  - `Spacing`.
- Path aliases: `@/*` → `src/*` and `@/assets/*` → `assets/*`.

## Data model and moderation

Firestore collections:

- `places` holds user submissions.
  - `post.tsx` uploads photos to Storage at `places/{uid}/…`, then creates the doc with `status: 'pending'`, `submittedBy`, `submittedByName`, `photoURLs`, `lat`/`lng` and `category` (a `Categories` key).
  - `admin.tsx` sets `status` to `approved` or `rejected`, and sets `notified: false`.
  - When the submitter next opens the Map screen, they get an alert and `notified` is set to `true`. That's the only field an owner may update.
  - Map and Discover show only `approved` places.
- `users/{uid}` holds `displayName`, `email` and `role` (`'user'` or `'admin'`). It's created at signup and backfilled on sign-in. The app checks admin with `useIsAdmin()`, and `firestore.rules` checks it with `isAdmin()`. `storage.rules` checks the same role through `firestore.get()`.
- `curatedAttractions` is admin-curated content for Explore Canada. Anyone can read it.
- `tasks` and `taskCompletions` (doc id `{uid}_{taskId}`) hold per-place tasks: see `use-place-tasks.ts`, with admin create/delete in `admin.tsx`. Neither collection has a match block in this repo's `firestore.rules`.

`functions/src/index.ts` has one trigger, `cleanupDeletedPlacePhotos`. When a `places` doc is deleted, it deletes that place's Storage photos.

The `scripts/*.ts` files are one-off scripts, run by hand with `npx tsx` (tsx isn't a dependency). They use the client SDK and sign in as the admin using the `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars (in PowerShell: `$env:ADMIN_EMAIL = '...'; $env:ADMIN_PASSWORD = '...'; npx tsx scripts/<name>.ts`), so `firestore.rules` still govern their writes. Each file's header comment lists its preconditions. Read it before running the script. `migrate-to-visits.ts` only does a dry run unless you pass `--execute`. Don't pass `--execute` while the app still reads photos, description and rating from `places`.

## The intro (`src/components/intro/`)

The intro is a ~6.9 s walk down a trail, drawn with Skia: deer, hiker, CN Tower, bear and birds, Niagara Falls, Peggy's Cove lighthouse, a plane skywriting the name, and the compass logo. It plays over the app on every cold launch on native and never on web.

- Render chain:
  1. `safe-intro.tsx` loads the intro.
  2. `intro.tsx` is the overlay: skip and tap-to-skip, Reduce Motion, and hiding the native splash once the first frame is drawn.
  3. `intro-journey.tsx` owns the Skia `Canvas`. It draws each frame on the UI thread via `useFrameCallback`, warms up the shaders behind the splash, and steps the ground resolution down if frames are slow.
  4. `scene.ts` exports `createScene(Skia)`, which builds every path, paint and shader once. The function it returns draws each frame.
- `world.ts` is the single source of the camera and of where everything is. World coordinates are in metres: `x` runs across the trail and `s` along it. The camera is level and moves forward in `s` over a ground that curves away like a small globe, so far-off things rise over the horizon.
- Each beat (`deer.ts`, `falls.ts`, `lighthouse.ts`, …) exports its own geometry and timing.
- The SkSL shaders are in `ground-shader.ts` and `falls-shaders.ts`.
- `palette.ts` holds the intro's colours, kept separate from `theme.ts`.
- `safe-intro.tsx` makes sure the intro can never stop the app from starting. It `require`s the intro synchronously with the global error handler swapped out, wraps it in an error boundary, and receives errors from frame drawing. Any failure is logged, the splash is hidden and the app carries on. Keep these guarantees when changing it.
- `scene.ts` takes the Skia API as a parameter instead of importing it, so frames can be rendered headlessly in Node with CanvasKit.
- `/intro-preview` plays the world on a loop, with pause and quarter-second stepping. It's dev only, unless `EXPO_PUBLIC_INTRO_PERF=1` is set. Query params: `?t=2.5` opens frozen at that time, `&debug=1` turns on the ground grid, `&ui=0` hides the controls. `EXPO_PUBLIC_INTRO_PERF=1` also overlays FPS and start-up timings on the real intro.
- `src/components/intro-splash.tsx` is the old SVG/Reanimated intro. Nothing imports it.
- `skia-gate.web.tsx` loads CanvasKit from a CDN pinned to `canvaskit-wasm@0.41.0`. That version must match the one `@shopify/react-native-skia` depends on.

Intro gotchas:

- `'worklet'` functions are not hoisted. The worklets Babel plugin turns each one into a variable that captures its closure at the point where it's declared. So declare a worklet after everything it uses. Also, don't call plain (non-worklet) functions from a worklet; compute those values outside it. esbuild skips this plugin, so an esbuild-based harness won't catch these bugs.
- Run `npm run check:intro` before any phone test of the intro. It runs every intro module through the real Metro transform for ios and android. It then loads the module graph in Node, rebuilds worklets the way the UI thread does, draws every frame, and forces failures to test `SafeIntro`. It also checks that the root layout plays the intro on native but not on web. It can't check visuals or shaders. If the intro imports a module with no stand-in, the check fails with a message telling you to add one in `scripts/check-intro.js`.
- The SkSL lives inside JS template literals, so never put backticks or `${` in shader comments. SkSL also reserves names like `half`, `in`, `out` and `floor`.

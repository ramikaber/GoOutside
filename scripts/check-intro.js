#!/usr/bin/env node

// Checks that the intro loads and draws the way it will on a phone, without a
// phone. Run it before every phone test:
//
//   node scripts/check-intro.js            (both platforms)
//   node scripts/check-intro.js ios
//
// Every intro module goes through this project's real Metro transform (Expo's
// transform worker: babel-preset-expo for Hermes, with the React Compiler and
// the react-native-worklets plugin), exactly as `expo start` would transform
// it. The module graph then runs in Node under a stand-in for Metro's module
// runtime, with small stand-ins for the native modules. It fails if:
//
//  1. a worklet captures something that's only initialised after it: the
//     worklets plugin turns each worklet into a variable holding a copy of
//     what it uses, taken where it's declared, so that copy is undefined
//     (a bundler that ignores the plugin, like esbuild, can't see this);
//  2. the intro's modules import each other in a cycle (with tables built at
//     load and copied into worklets, a cycle hands someone half a module);
//  3. any module throws while it loads, or requires an asset (the video, its
//     sound) that isn't there;
//  4. a worklet, rebuilt from its code the way the UI thread rebuilds it,
//     captures undefined or calls a function that isn't a worklet;
//  5. the scene throws drawing any frame of the intro on that rebuilt UI side;
//  6. SafeIntro fails to turn a forced failure into a skipped intro (logged,
//     splash hidden, onFinish called once), for both intros. For the video
//     one: its module failing to load, rendering, the video failing to play,
//     its first frame not showing within 3 s, or it stalling so it hasn't
//     ended within 9 s. For the Skia one: loading, rendering, drawing a
//     frame. Or, playing normally, the intro never starts (its first frame
//     shown);
//  7. the video intro, with stand-in players, doesn't: hide the splash on
//     its first frame; play muted, mixing with other apps' audio; start the
//     sound after the video starts, in its own mode (quiet on silent), at
//     the picture's time; hand off into the app (fade, and grow 1.6×, over
//     650 ms) once, 6.6 s into the video by its time updates, though they
//     keep coming, or at its end if they never come; fade out on Skip or a
//     tap; skip the video with Reduce Motion on; or play on without its
//     sound;
//  8. the journey doesn't step the ground's resolution down when frames are
//     slow, or does when they keep up;
//  9. the root layout doesn't play the intro on every launch on a phone (or
//     does on the web), with the rest of the app stood in for.
//
// It can't check how things look, the native modules themselves (whether
// the video and sound really play, in sync, and quiet on silent: that needs
// a phone), or the shaders (those need the headless CanvasKit render).

/* global __dirname, Buffer */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const introDir = path.join(projectRoot, 'src', 'components', 'intro');
const fromProject = (name) => require(require.resolve(name, { paths: [projectRoot] }));

const React = fromProject('react');
const parser = fromProject('@babel/parser');
const traverse = fromProject('@babel/traverse').default;
const skiaTypes = fromProject('@shopify/react-native-skia/lib/commonjs/skia/types');

const appConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8')).expo;
const relative = (file) => path.relative(projectRoot, file).replace(/\\/g, '/');

// ---------------------------------------------------------------------------
// Metro's transform, as `expo start` runs it for a phone.

let metro;
// Every check builds its own module graph, mostly of the same files, so each
// file is transformed once per platform (and per version of its source).
const transforms = new Map();
function transform(file, platform, source) {
  source ??= fs.readFileSync(file, 'utf8');
  const key = `${platform}\n${file}\n${source}`;
  if (!transforms.has(key)) transforms.set(key, transformAfresh(file, platform, source));
  return transforms.get(key);
}

async function transformAfresh(file, platform, source) {
  if (!metro) {
    const { getDefaultConfig } = fromProject('expo/metro-config');
    const config = getDefaultConfig(projectRoot);
    const { transform: transformOptions } = await config.transformer.getTransformOptions([], {}, () => []);
    metro = {
      config,
      worker: fromProject('@expo/metro-config/build/transform-worker/metro-transform-worker'),
      transformOptions,
    };
  }
  const out = await metro.worker.transform(
    { ...metro.config.transformer, projectRoot },
    projectRoot,
    path.relative(projectRoot, file),
    Buffer.from(source),
    {
      dev: true,
      hot: true,
      minify: false,
      platform,
      type: 'module',
      unstable_transformProfile: 'hermes-stable',
      inlinePlatform: true,
      inlineRequires: false,
      nonInlinedRequires: [],
      experimentalImportSupport: metro.transformOptions.experimentalImportSupport,
      customTransformOptions: {
        engine: 'hermes',
        routerRoot: 'src/app',
        ...(appConfig.experiments?.reactCompiler ? { reactCompiler: 'true' } : {}),
      },
      publicPath: '/assets',
    },
  );
  return { code: out.output[0].data.code, dependencies: out.dependencies.map((d) => d.name) };
}

// ---------------------------------------------------------------------------
// Check 1: worklets capturing what's initialised after them. Reads the
// transformed code: each worklet is now `var name = function nameFactory({
// captured }) {...}({ captured })`, run where the function was declared.

function laterCaptures(code, file) {
  const problems = [];
  const ast = parser.parse(code, { sourceType: 'script' });
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type !== 'FunctionExpression' || !/Factory$/.test(callee.id?.name ?? '')) return;
      const captured = p.node.arguments[0];
      if (captured?.type !== 'ObjectExpression') return;
      const statement = p.getStatementParent();
      const block = statement.parentPath;
      const body = block.node.body;
      const at = body.indexOf(statement.node);
      const scopeBlock = block.isProgram() ? block.node : block.parent;
      for (const property of captured.properties) {
        if (property.value.type !== 'Identifier') continue;
        const binding = p.scope.getBinding(property.value.name);
        if (!binding || binding.kind === 'hoisted' || binding.scope.block !== scopeBlock) continue;
        const declaredAt = body.indexOf(binding.path.getStatementParent().node);
        if (declaredAt > at) {
          const worklet = callee.id.name.replace(/Factory$/, '').replace(/_[A-Za-z]+Ts\d+$/, '');
          problems.push(
            `${relative(file)}: worklet ${worklet} uses ${property.value.name}, which is declared after it, ` +
              `so it captures undefined. Declare ${property.value.name} before ${worklet}.`,
          );
        }
      }
    },
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Stand-ins for native modules.

const HOST = Symbol('host object');

// Something native (a Skia object, a canvas): any property, call or `new`
// gives another one, and it reads as 0 in arithmetic.
function host(name) {
  const cache = new Map();
  return new Proxy(function () {}, {
    get(_, key) {
      if (key === HOST) return true;
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === Symbol.iterator) return function* () {};
      if (key === 'toString') return () => `[${name}]`;
      if (!cache.has(key)) cache.set(key, host(`${name}.${String(key)}`));
      return cache.get(key);
    },
    apply: () => host(`${name}()`),
    construct: () => host(`new ${name}`),
  });
}
const hostFunction = (fn) => Object.assign(fn, { [HOST]: true });

function standIns(platform, ui, calls, media, clock) {
  const { useState } = React;
  // Runs a worklet as the UI thread would: rebuilt from its code, with the
  // UI runtime's _WORKLET flag up.
  const onUI = (worklet) => {
    const previous = global._WORKLET;
    global._WORKLET = true;
    try {
      return ui(worklet)();
    } finally {
      global._WORKLET = previous;
    }
  };
  // A shared value: the same object on both threads (as Reanimated's are,
  // in effect), so it isn't copied to the UI side like a plain object.
  const mutable = (value) => ({
    [HOST]: true,
    value,
    get() {
      return this.value;
    },
    set(next) {
      this.value = next;
    },
  });
  const window = platform === 'ios' ? { width: 390, height: 844 } : { width: 412, height: 915 };
  const esm = (exports) => ({ __esModule: true, ...exports });
  return {
    react: React,
    'react/jsx-runtime': fromProject('react/jsx-runtime'),
    'react/jsx-dev-runtime': fromProject('react/jsx-dev-runtime'),
    'react/compiler-runtime': fromProject('react/compiler-runtime'),
    'react-native': esm({
      Platform: { OS: platform, select: (o) => (platform in o ? o[platform] : 'native' in o ? o.native : o.default) },
      StyleSheet: {
        create: (styles) => styles,
        absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
        absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
        hairlineWidth: 1,
        flatten: (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)),
      },
      useWindowDimensions: () => ({ ...window, scale: 3, fontScale: 1 }),
      useColorScheme: () => 'light',
      PixelRatio: { get: () => 3 },
      Dimensions: { get: () => ({ ...window, scale: 3, fontScale: 1 }) },
      View: 'View',
      Text: 'Text',
      Pressable: 'Pressable',
    }),
    '@shopify/react-native-skia': esm({
      ...skiaTypes,
      Skia: host('Skia'),
      createPicture: hostFunction((draw) => {
        draw(host('canvas'));
        return host('picture');
      }),
      Canvas: 'SkiaCanvas',
      Picture: 'SkiaPicture',
    }),
    'react-native-worklets': esm({
      scheduleOnRN: hostFunction((fn, ...args) => queueMicrotask(() => (fn.onJS ?? fn)(...args))),
      scheduleOnUI: hostFunction((fn, ...args) => queueMicrotask(() => ui(fn)(...args))),
    }),
    'react-native-reanimated': esm({
      default: { View: 'Animated.View', Text: 'Animated.Text', createAnimatedComponent: (c) => c },
      Easing: new Proxy({}, { get: () => (x) => (typeof x === 'function' ? x : (t) => t) }),
      Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
      makeMutable: mutable,
      useSharedValue: (value) => useState(() => mutable(value))[0],
      // Runs the worklet once, on the stand-in UI side.
      useDerivedValue: (worklet) => useState(() => mutable(onUI(worklet)))[0],
      useAnimatedStyle: (worklet) => onUI(worklet),
      useAnimatedReaction: () => {},
      // Kept, so checks can play frames through them (frameCallbacks).
      useFrameCallback: (worklet) => {
        useState(() => calls.frameCallbacks?.push(worklet));
        return { setActive: () => {}, isActive: true };
      },
      useReducedMotion: () => false,
      withTiming: hostFunction((to) => to),
      withSpring: hostFunction((to) => to),
      withDelay: hostFunction((_, animation) => animation),
      withRepeat: hostFunction((animation) => animation),
      withSequence: hostFunction((...animations) => animations[animations.length - 1]),
      cancelAnimation: hostFunction(() => {}),
      interpolate: hostFunction((x, [a, b], [c, d]) => c + ((d - c) * Math.min(Math.max((x - a) / (b - a), 0), 1))),
    }),
    'react-native-safe-area-context': esm({
      useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
    }),
    'expo-splash-screen': esm({
      hide: () => calls.push('SplashScreen.hide'),
      hideAsync: async () => calls.push('SplashScreen.hide'),
      preventAutoHideAsync: async () => {},
    }),
    ...mediaStandIns(calls, media, clock),
    'expo-router': esm({ useLocalSearchParams: () => ({}), useRouter: () => ({ back() {}, push() {} }) }),
    // Where development builds read EXPO_PUBLIC_ variables from.
    'expo/virtual/env': { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('EXPO_PUBLIC_'))) },
    'expo/internal/async-require-module': (id, _paths, name) => Promise.resolve().then(() => currentRuntime.importAll(id, name)),
  };
}

// expo-video and expo-audio. The video player loads, plays and ends as the
// real one reports it, through the same events. While it plays, its time
// runs on `clock` (the checks' clock, sped up as their timers are), and it
// reports that time in a 'timeUpdate' at every whole timeUpdateEventInterval
// (none when that's 0, the default). VideoView reports its first frame once
// the player is ready. What's done to them, and what they report, goes in
// `calls`. `media` forces failures: fails (the video can't play),
// noFirstFrame, stalls (it gets stuck partway: its time stops and it never
// ends), noTimeUpdates (it never reports its time), renderThrows
// (VideoView), noSound.
const VIDEO_LOAD_MS = 50;
const VIDEO_LENGTH_S = 7.4;
const VIDEO_STALLS_AT_S = 2;
function mediaStandIns(calls, media, clock) {
  const esm = (exports) => ({ __esModule: true, ...exports });
  const createPlayer = (source) => {
    const listeners = {};
    const timers = new Set();
    const later = (fn, ms) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
      return timer;
    };
    const detail = (payload) => {
      if ('status' in payload) return ` ${payload.status}`;
      if ('isPlaying' in payload) return ` ${payload.isPlaying}`;
      if ('currentTime' in payload) return ` ${payload.currentTime.toFixed(3)}`;
      return '';
    };
    const emit = (event, payload = {}) => {
      calls.push(`video ${event}${detail(payload)}`);
      for (const listener of [...(listeners[event] ?? [])]) listener(payload);
    };

    // Its time, s: where it was when it last started or stopped playing, plus
    // the time since on the clock while it plays.
    let position = 0;
    let since;
    const stopsAt = media.stalls ? VIDEO_STALLS_AT_S : VIDEO_LENGTH_S;
    const time = () => Math.min(stopsAt, position + (since === undefined ? 0 : (clock() - since) / 1000));
    // While it plays: a timeUpdate at each whole interval of its time, then
    // playToEnd at the end (or, stalled, nothing more). Updates that came due
    // while a timer was late (Windows runs Node's timers every ~15 ms, a
    // tenth of a second of the video here) come together, each with its own
    // time, as they would on a phone whose JS thread was busy.
    let reported = 0;
    const nextUpdate = (interval) => Number(((Math.floor(reported / interval + 1e-6) + 1) * interval).toFixed(6));
    let ticking;
    const run = () => {
      const at = time();
      const interval = media.noTimeUpdates ? 0 : player.timeUpdateEventInterval;
      if (interval > 0) {
        for (let next = nextUpdate(interval); next <= at + 1e-6 && next < VIDEO_LENGTH_S && player.playing; next = nextUpdate(interval)) {
          reported = next;
          emit('timeUpdate', { currentTime: next, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: VIDEO_LENGTH_S });
        }
      }
      if (!player.playing) return;
      if (at >= VIDEO_LENGTH_S) {
        position = VIDEO_LENGTH_S;
        since = undefined;
        player.playing = false;
        emit('playToEnd');
        emit('playingChange', { isPlaying: false, oldIsPlaying: true });
        return;
      }
      if (at >= stopsAt) return;
      const next = interval > 0 ? Math.min(stopsAt, nextUpdate(interval)) : stopsAt;
      ticking = later(run, (next - at) * 1000);
    };

    const player = {
      status: source == null ? 'idle' : 'loading',
      playing: false,
      get currentTime() {
        return time();
      },
      set currentTime(seconds) {
        position = seconds;
        if (since !== undefined) since = clock();
      },
      timeUpdateEventInterval: 0,
      muted: false,
      loop: false,
      audioMixingMode: 'auto',
      addListener(event, listener) {
        (listeners[event] ??= new Set()).add(listener);
        return { remove: () => listeners[event].delete(listener) };
      },
      play() {
        calls.push('video play()');
        if (player.playing) return;
        player.playing = true;
        since = clock();
        later(() => emit('playingChange', { isPlaying: true, oldIsPlaying: false }), 0);
        run();
      },
      pause() {
        calls.push('video pause()');
        clearTimeout(ticking);
        if (!player.playing) return;
        position = time();
        since = undefined;
        player.playing = false;
        later(() => emit('playingChange', { isPlaying: false, oldIsPlaying: true }), 0);
      },
      release() {
        calls.push('video release()');
        for (const timer of timers) clearTimeout(timer);
      },
    };
    if (source != null) {
      later(() => {
        player.status = media.fails ? 'error' : 'readyToPlay';
        const error = media.fails ? { message: 'forced: the video failed to play' } : undefined;
        emit('statusChange', { status: player.status, oldStatus: 'loading', error });
      }, VIDEO_LOAD_MS);
    }
    (calls.videoPlayers ??= []).push(player);
    return player;
  };

  return {
    'expo-video': esm({
      useVideoPlayer: (source, setup) => {
        const [player] = React.useState(() => {
          calls.push(source == null ? 'video created with no source' : 'video created');
          const created = createPlayer(source);
          setup?.(created);
          return created;
        });
        React.useEffect(() => () => player.release(), [player]);
        return player;
      },
      VideoView: function VideoView(props) {
        if (media.renderThrows) throw new Error('forced: rendering failed');
        const latest = React.useRef(props);
        latest.current = props;
        React.useEffect(() => {
          const { player } = latest.current;
          if (!player || media.noFirstFrame) return;
          let timer;
          const show = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              calls.push('video first frame');
              latest.current.onFirstFrameRender?.();
            }, 10);
          };
          const subscription = player.addListener('statusChange', ({ status }) => status === 'readyToPlay' && show());
          if (player.status === 'readyToPlay') show();
          return () => {
            clearTimeout(timer);
            subscription.remove();
          };
        }, []);
        return React.createElement('VideoView', props);
      },
    }),
    'expo-audio': esm({
      setAudioModeAsync: async (mode) => {
        calls.push(`setAudioModeAsync ${JSON.stringify(mode)}`);
      },
      createAudioPlayer: () => {
        if (media.noSound) throw new Error('forced: the sound failed to load');
        calls.push('sound created');
        return {
          playing: false,
          currentTime: 0,
          isLoaded: true,
          play() {
            calls.push('sound play()');
            this.playing = true;
          },
          pause() {
            calls.push('sound pause()');
            this.playing = false;
          },
          async seekTo(seconds) {
            calls.push('sound seekTo()');
            this.currentTime = seconds;
          },
          remove() {
            calls.push('sound remove()');
          },
        };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// The UI thread, as the worklets runtime builds it: each worklet is evaluated
// afresh from its code string and bound to a copy of what it captured. Plain
// JS functions it captured can't be called there.

function makeUI() {
  const compiled = new Map();
  const copies = new Map();
  const problems = [];
  const toUI = (value, where) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (value[HOST] || ArrayBuffer.isView(value)) return value;
    if (copies.has(value)) return copies.get(value);
    if (typeof value === 'function') {
      const data = value.__initData;
      if (value.__workletHash === undefined || !data) {
        const name = value.name || 'anonymous';
        const remote = () => {
          throw new Error(`Tried to synchronously call a non-worklet function \`${name}\` on the UI thread.`);
        };
        remote.onJS = value;
        copies.set(value, remote);
        return remote;
      }
      if (!compiled.has(value.__workletHash)) {
        compiled.set(
          value.__workletHash,
          vm.runInThisContext(`(${data.code}\n)`, { filename: `[UI thread] ${relative(data.location)}` }),
        );
      }
      const closure = {};
      const fn = compiled.get(value.__workletHash).bind({ __closure: closure });
      copies.set(value, fn);
      const name = (data.code.match(/^function ([\w$]*)/)?.[1] || 'anonymous worklet').replace(/_[A-Za-z]+Ts\d+$/, '');
      for (const [key, captured] of Object.entries(value.__closure ?? {})) {
        if (captured === undefined && where) {
          problems.push(`${relative(data.location)}: worklet ${name} captures ${key} as undefined (${where}).`);
        }
        if (typeof captured === 'function' && captured.__workletHash === undefined && !captured[HOST] && where) {
          if (new RegExp(`(^|[^\\w$.])${key.replace(/\$/g, '\\$')}\\s*\\(`).test(data.code)) {
            problems.push(
              `${relative(data.location)}: worklet ${name} calls ${key}, which isn't a worklet, so it throws on the UI thread (${where}).`,
            );
          }
        }
        closure[key] = toUI(captured, where);
      }
      return fn;
    }
    if (Array.isArray(value)) {
      const copy = [];
      copies.set(value, copy);
      value.forEach((item, i) => (copy[i] = toUI(item, where)));
      return copy;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const copy = {};
    copies.set(value, copy);
    for (const key of Object.keys(value)) copy[key] = toUI(value[key], where);
    return copy;
  };
  return { toUI, problems };
}

// ---------------------------------------------------------------------------
// Metro's module runtime, enough of it: modules run on first require, and a
// module that throws while loading is reported to ErrorUtils as fatal and
// gives undefined, as metro-runtime's guardedLoadModule does.

let currentRuntime;
class Runtime {
  constructor(platform, { overrides = {}, calls = [], media = {}, clock = () => performance.now() } = {}) {
    this.platform = platform;
    this.overrides = overrides;
    this.calls = calls;
    this.modules = new Map();
    this.inGuard = false;
    this.fatal = [];
    this.transformed = new Map();
    this.graph = new Map();
    this.ui = makeUI();
    this.standIns = standIns(platform, (worklet) => this.ui.toUI(worklet), calls, media, clock);
  }

  get sourceExts() {
    return metro.config.resolver.sourceExts;
  }

  resolve(name, from) {
    if (!name.startsWith('.') && !name.startsWith('@/')) {
      if (!(name in this.standIns)) {
        throw new Error(`${relative(from)} imports ${name}, which has no stand-in: add one in scripts/check-intro.js.`);
      }
      return name;
    }
    const base = name.startsWith('@/assets/')
      ? path.join(projectRoot, 'assets', name.slice('@/assets/'.length))
      : name.startsWith('@/')
        ? path.join(projectRoot, 'src', name.slice(2))
        : path.resolve(path.dirname(from), name);
    // An asset (the intro's video, its sound): Metro hands back a number.
    if (metro.config.resolver.assetExts.includes(path.extname(base).slice(1))) {
      if (!fs.existsSync(base)) throw new Error(`${relative(from)} requires ${name}, which isn't there.`);
      const id = `asset ${relative(base)}`;
      this.standIns[id] ??= Object.keys(this.standIns).filter((key) => key.startsWith('asset ')).length + 1;
      return id;
    }
    for (const candidate of [base, path.join(base, 'index')]) {
      for (const ext of this.sourceExts) {
        for (const variant of [`.${this.platform}.${ext}`, `.native.${ext}`, `.${ext}`]) {
          if (fs.existsSync(candidate + variant)) return candidate + variant;
        }
      }
    }
    throw new Error(`Can't resolve ${name} from ${relative(from)}`);
  }

  async prepare(file) {
    if (this.transformed.has(file) || !path.isAbsolute(file)) return;
    this.transformed.set(file, null);
    const { code, dependencies } = await transform(file, this.platform, this.overrides[file]);
    const resolved = dependencies.map((name) => this.resolve(name, file));
    this.transformed.set(file, { code, resolved });
    this.graph.set(file, resolved.filter((d) => path.isAbsolute(d)));
    await Promise.all(resolved.map((d) => this.prepare(d)));
  }

  require(id) {
    if (!path.isAbsolute(id)) return this.standIns[id];
    const module = this.modules.get(id);
    if (module?.initialized) return module.exports;
    if (!this.inGuard && global.ErrorUtils) {
      this.inGuard = true;
      let exports;
      try {
        exports = this.load(id);
      } catch (error) {
        global.ErrorUtils.reportFatalError(error);
      }
      this.inGuard = false;
      return exports;
    }
    return this.load(id);
  }

  load(id) {
    let module = this.modules.get(id);
    if (module?.error) throw module.error;
    const { code, resolved } = this.transformed.get(id) ?? {};
    if (code === undefined) throw new Error(`${relative(id)} wasn't prepared`);
    let factory;
    global.__d = (f) => (factory = f);
    vm.runInThisContext(code, { filename: relative(id) });
    module = { exports: {}, initialized: true };
    this.modules.set(id, module);
    const dependencyMap = Object.assign([...resolved], { paths: {} });
    try {
      factory(
        global,
        (dep) => this.require(dep),
        (dep) => this.importDefault(dep),
        (dep) => this.importAll(dep),
        module,
        module.exports,
        dependencyMap,
      );
    } catch (error) {
      module.initialized = false;
      module.error = error;
      throw error;
    }
    return module.exports;
  }

  importDefault(id) {
    const exports = this.require(id);
    return exports && exports.__esModule ? exports.default : exports;
  }

  importAll(id) {
    const exports = this.require(id);
    if (exports && exports.__esModule) return exports;
    return { ...exports, default: exports };
  }

  // Where the error came from, in the transformed code, with a snippet.
  locate(error) {
    const frame = String(error?.stack ?? '')
      .split('\n')
      .map((line) => line.match(/\((?:\[UI thread\] )?([^()]+?):(\d+):(\d+)\)$/) ?? line.match(/at (?:\[UI thread\] )?([^ ]+?):(\d+):(\d+)$/))
      .find((m) => m && fs.existsSync(path.join(projectRoot, m[1])));
    if (!frame) return '';
    const file = path.join(projectRoot, frame[1]);
    const code = this.transformed.get(file)?.code;
    if (!code || error.stack.includes('[UI thread]')) return `\n    at ${frame[1]}`;
    const lines = code.split('\n');
    const at = Number(frame[2]);
    const snippet = lines
      .slice(Math.max(at - 3, 0), at + 1)
      .map((line, i) => `${at - 2 + i === at ? '  > ' : '    '}${line.slice(0, 140)}`)
      .join('\n');
    return `\n    at ${frame[1]} (line ${at} of Metro's output):\n${snippet}`;
  }
}

function installGlobals(runtime) {
  currentRuntime = runtime;
  global.__DEV__ = true;
  global.$RefreshReg$ = () => {};
  global.$RefreshSig$ = () => (type) => type;
  let handler = (error) => runtime.fatal.push(error);
  global.ErrorUtils = {
    setGlobalHandler: (fn) => (handler = fn),
    getGlobalHandler: () => handler,
    reportError: (error) => handler(error, false),
    reportFatalError: (error) => handler(error, true),
  };
}

function cycles(graph) {
  const found = new Set();
  const visit = (file, stack) => {
    if (stack.includes(file)) {
      found.add([...stack.slice(stack.indexOf(file)), file].map(relative).join(' -> '));
      return;
    }
    for (const dep of graph.get(file) ?? []) visit(dep, [...stack, file]);
  };
  for (const file of graph.keys()) visit(file, []);
  return [...found];
}

const introModules = (platform) =>
  fs
    .readdirSync(introDir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.(web|ios|android|native)\.tsx?$/.test(f))
    .map((f) => {
      const base = f.replace(/\.tsx?$/, '');
      const own = ['ts', 'tsx'].map((ext) => path.join(introDir, `${base}.${platform}.${ext}`)).find(fs.existsSync);
      return own ?? path.join(introDir, f);
    });

// ---------------------------------------------------------------------------
// Checks 1–5, on one platform.

async function checkLoading(platform, overrides = {}) {
  const failures = [];
  const runtime = new Runtime(platform, { overrides });
  installGlobals(runtime);
  const entries = introModules(platform);
  for (const entry of entries) await runtime.prepare(entry);
  const local = [...runtime.transformed.keys()].filter((f) => f.startsWith(introDir));

  for (const file of local) failures.push(...laterCaptures(runtime.transformed.get(file).code, file));
  for (const cycle of cycles(new Map([...runtime.graph].filter(([f]) => f.startsWith(introDir))))) {
    failures.push(`Import cycle: ${cycle}`);
  }

  for (const entry of entries) {
    runtime.require(entry);
    for (const error of runtime.fatal.splice(0)) {
      failures.push(`${relative(entry)} threw while loading: ${error?.stack?.split('\n')[0] ?? error}${runtime.locate(error)}`);
    }
  }

  const exports = (file) => runtime.modules.get(file)?.exports ?? {};
  for (const file of local) {
    for (const [name, value] of Object.entries(exports(file))) {
      if (typeof value === 'function' && value.__workletHash !== undefined) runtime.ui.toUI(value, `exported as ${name}`);
    }
  }

  // Every frame, drawn with the UI side's copy of the scene.
  const scene = exports(path.join(introDir, 'scene.ts'));
  const world = exports(path.join(introDir, 'world.ts'));
  let frames = 0;
  if (scene.createScene && world.RUN_SECONDS) {
    let drawJS;
    try {
      drawJS = scene.createScene(runtime.standIns['@shopify/react-native-skia'].Skia);
    } catch (error) {
      failures.push(`createScene threw: ${error?.stack?.split('\n')[0]}${runtime.locate(error)}`);
    }
    if (drawJS) {
      const drawUI = runtime.ui.toUI(drawJS, 'drawScene');
      const sizes = platform === 'ios' ? [[390, 844], [430, 932]] : [[412, 915], [360, 800]];
      const failed = new Set();
      for (const [width, height] of sizes) {
        for (let frame = 0; frame <= Math.ceil(world.RUN_SECONDS * 30); frame++) {
          const time = Math.min(frame / 30, world.RUN_SECONDS);
          // As the intro draws them (the ground at its own resolution, the
          // lowest step every few frames), and in the preview's debug view.
          const variants = [{ debug: false, groundResolution: 1.5 }];
          if (frame % 6 === 0) variants.push({ debug: true }, { debug: false, groundResolution: 0.75 });
          for (const options of variants) {
            frames++;
            try {
              drawUI(host('canvas'), time, width, height, options);
            } catch (error) {
              const message = String(error?.message ?? error);
              if (failed.has(message)) continue;
              failed.add(message);
              let where = runtime.locate(error);
              // The UI side's code is one line per worklet: find the line on
              // the JS side, if it throws there too.
              try {
                drawJS(host('canvas'), time, width, height, options);
              } catch (jsError) {
                where = runtime.locate(jsError) || where;
              }
              failures.push(`drawScene threw on the UI thread at ${time.toFixed(2)} s (${width}×${height}): ${message}${where}`);
            }
          }
        }
      }
    }
  } else {
    failures.push("Didn't draw any frames: scene.ts or world.ts didn't load.");
  }
  failures.unshift(...runtime.ui.problems.filter((p, i, all) => all.indexOf(p) === i));
  return { failures, modules: local.length, frames };
}

// ---------------------------------------------------------------------------
// Checks 6, 7 and 9: SafeIntro, and the root layout, rendered for real
// (react-reconciler). Failures are forced by swapping in a module that fails,
// or by telling a stand-in (the video player) to fail.

function makeRenderer(onUncaught) {
  const Reconciler = fromProject('react-reconciler');
  const { DefaultEventPriority } = fromProject('react-reconciler/constants');
  let priority = DefaultEventPriority;
  const add = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => parent.children.splice(parent.children.indexOf(child), 1);
  const before = (parent, child, next) => parent.children.splice(parent.children.indexOf(next), 0, child);
  const renderer = Reconciler({
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    isPrimaryRenderer: true,
    supportsMicrotasks: true,
    scheduleMicrotask: queueMicrotask,
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    noTimeout: -1,
    createInstance: (type, props) => ({ type, props, children: [] }),
    createTextInstance: (text) => ({ text }),
    appendInitialChild: add,
    appendChild: add,
    appendChildToContainer: add,
    insertBefore: before,
    insertInContainerBefore: before,
    removeChild: remove,
    removeChildFromContainer: remove,
    clearContainer: (container) => (container.children = []),
    finalizeInitialChildren: () => false,
    shouldSetTextContent: () => false,
    getRootHostContext: () => ({}),
    getChildHostContext: (context) => context,
    getPublicInstance: (instance) => instance,
    prepareForCommit: () => null,
    resetAfterCommit: () => {},
    preparePortalMount: () => {},
    commitUpdate: (instance, _type, _old, props) => (instance.props = props),
    commitTextUpdate: (instance, _old, text) => (instance.text = text),
    hideInstance: () => {},
    unhideInstance: () => {},
    hideTextInstance: () => {},
    unhideTextInstance: () => {},
    detachDeletedInstance: () => {},
    getCurrentUpdatePriority: () => priority,
    setCurrentUpdatePriority: (p) => (priority = p),
    resolveUpdatePriority: () => priority,
    maySuspendCommit: () => false,
    preloadInstance: () => true,
    startSuspendingCommit: () => {},
    suspendInstance: () => {},
    waitForCommitToBeReady: () => null,
    shouldAttemptEagerTransition: () => false,
    requestPostPaintCallback: () => {},
    resolveEventType: () => null,
    resolveEventTimeStamp: () => -1.1,
    trackSchedulerEvent: () => {},
    resetFormInstance: () => {},
    NotPendingTransition: null,
    HostTransitionContext: React.createContext(null),
  });
  const container = { children: [] };
  const root = renderer.createContainer(container, 1, null, false, null, '', onUncaught, () => {}, () => {}, null);
  return {
    render: (element) => renderer.updateContainer(element, root, null, null),
    container,
  };
}

// Lets effects, microtasks and Suspense's retries run: until `done`, or for
// `ms` at most.
const settle = async (ms, done = () => false) => {
  const until = Date.now() + ms;
  while (Date.now() < until && !done()) await new Promise((resolve) => setTimeout(resolve, 10));
};

// The root layout plays the intro every time the app starts on a phone, and
// never on the web: rendered as two cold launches in a row, each a fresh
// module graph, as a launch is. The rest of the app (its tabs, Firebase,
// fonts, navigation theme) is stood in for; the intro and its safety net are
// the real ones. Nothing in the layout or the intro may use storage any more
// (remembering it played is what made it first-launch only): there's no
// stand-in for it, so an import of it fails this check.
async function checkLaunch(platform, extraOverrides = {}) {
  const failures = [];
  const layoutFile = path.join(projectRoot, 'src', 'app', '_layout.tsx');
  const resolveIn = (name) => path.join(projectRoot, 'src', name);
  const launch = async (os) => {
    const calls = [];
    const overrides = {
      ...extraOverrides,
      [resolveIn('components/app-tabs.tsx')]: 'export default function AppTabs() { return null; }',
      [resolveIn('lib/firebase.ts')]: 'export const auth = {}; export const db = {};',
    };
    const runtime = new Runtime(platform, { overrides, calls });
    installGlobals(runtime);
    const stand = runtime.standIns;
    stand['react-native'] = { ...stand['react-native'], Platform: { ...stand['react-native'].Platform, OS: os } };
    stand['expo-font'] = { __esModule: true, useFonts: () => [true] };
    for (const font of ['marcellus', 'cormorant-garamond', 'jetbrains-mono', 'inter']) {
      stand[`@expo-google-fonts/${font}`] = new Proxy({ __esModule: true }, { get: (target, key) => (key in target ? target[key] : String(key)) });
    }
    stand['firebase/auth'] = { __esModule: true, onAuthStateChanged: () => () => {} };
    stand['firebase/firestore'] = { __esModule: true, doc: () => ({}), getDoc: async () => ({ exists: () => true }), serverTimestamp: () => 0, setDoc: async () => {} };
    stand['react-native-gesture-handler'] = { __esModule: true, GestureHandlerRootView: 'View' };
    stand['expo-router'] = { ...stand['expo-router'], DarkTheme: {}, DefaultTheme: {}, ThemeProvider: ({ children }) => children };
    await runtime.prepare(layoutFile);
    const { default: Layout } = runtime.require(layoutFile);
    const uncaught = [];
    const { render } = makeRenderer((error) => uncaught.push(error));
    render(React.createElement(Layout));
    await settle(1000, () => calls.includes('SplashScreen.hide'));
    const marks = runtime.modules.get(path.join(introDir, 'perf.ts'))?.exports.introMarks;
    // Unmounted, so nothing it left running (the intro's watchdogs) goes off
    // during later checks.
    render(null);
    await settle(20);
    return { runtime, calls, uncaught, marks };
  };

  const problems = [];
  let first;
  try {
    first = await launch(platform);
  } catch (error) {
    console.log('    FAIL the intro plays on every launch (two in a row), and not on the web');
    return [`Launch: ${error.message}`];
  }
  if (first.uncaught.length) problems.push(`the layout threw: ${first.uncaught[0]?.stack ?? first.uncaught[0]}`);
  if (first.runtime.fatal.length) problems.push(`a fatal error was reported: ${first.runtime.fatal[0]?.stack ?? first.runtime.fatal[0]}`);
  if (first.marks?.mounted === undefined) problems.push("the intro didn't play on the first launch");
  if (!first.calls.includes('SplashScreen.hide')) problems.push('the splash never came down on the first launch');
  const second = await launch(platform);
  if (second.marks?.mounted === undefined) problems.push("the intro didn't play on the second launch");
  const web = await launch('web');
  if (web.marks?.mounted !== undefined) problems.push('the intro played on the web');
  if (!web.calls.includes('SplashScreen.hide')) problems.push("the splash never came down on the web");
  console.log(`    ${problems.length ? 'FAIL' : 'ok  '} the ${launchKind()} intro plays on every launch (two in a row), and not on the web`);
  failures.push(...problems.map((p) => `Launch: ${p}`));
  return failures;
}

// The journey steps the ground's resolution down when frames are slow (and
// only then): rendered, with its frame callbacks played slow or fast frames.
async function checkAdaptive(platform) {
  const failures = [];
  for (const [label, interval, expectDown] of [
    ['frames are slow (30 ms)', 30, true],
    ['frames keep up (16.7 ms)', 1000 / 60, false],
  ]) {
    const calls = [];
    calls.frameCallbacks = [];
    const runtime = new Runtime(platform, { calls });
    installGlobals(runtime);
    const file = path.join(introDir, 'intro-journey.tsx');
    await runtime.prepare(file);
    const { IntroJourney } = runtime.require(file);
    const shared = (value) => runtime.standIns['react-native-reanimated'].makeMutable(value);
    const time = shared(0);
    const level = shared(0);
    const uncaught = [];
    const { render } = makeRenderer((error) => uncaught.push(error));
    render(React.createElement(IntroJourney, { time, level }));
    await settle(200);
    time.value = 1;
    global._WORKLET = true;
    try {
      for (let frame = 0; frame < 120; frame++) {
        for (const callback of calls.frameCallbacks) runtime.ui.toUI(callback)({ timeSincePreviousFrame: interval });
      }
    } finally {
      global._WORKLET = undefined;
    }
    const problems = [];
    if (uncaught.length) problems.push(`it threw: ${uncaught[0]?.stack ?? uncaught[0]}`);
    if (!calls.frameCallbacks.length) problems.push('it registered no frame callback');
    if (expectDown && level.value === 0) problems.push("the ground's resolution didn't step down");
    if (!expectDown && level.value !== 0) problems.push(`the ground's resolution stepped down (to level ${level.value})`);
    console.log(`    ${problems.length ? 'FAIL' : 'ok  '} ground resolution when ${label}: level ${level.value}`);
    failures.push(...problems.map((p) => `Adaptive quality, when ${label}: ${p}`));
  }
  return failures;
}

const safeIntroFile = path.join(introDir, 'safe-intro.tsx');
const videoIntroFile = path.join(introDir, 'video-intro.tsx');
const INTRO_KIND = /const INTRO_KIND\b[^=]*= '(\w+)';/;

// Which intro safe-intro.tsx plays on launch: 'video' or 'skia'.
function launchKind() {
  const kind = fs.readFileSync(safeIntroFile, 'utf8').match(INTRO_KIND)?.[1];
  if (!kind) throw new Error("Can't find INTRO_KIND in safe-intro.tsx: update INTRO_KIND in scripts/check-intro.js to match it.");
  return kind;
}

// The video intro's timers run this many times faster in these checks, so
// its watchdogs (3 s, 9 s) take a fraction of a second.
const VIDEO_SPEED = 10;

const describe = (args) => args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ');

// Renders SafeIntro, made to play the `kind` of intro whatever INTRO_KIND
// says, and returns a handle: wait(ms, until) lets that much of the intro's
// time pass (or until until(calls)), press(button) presses a Pressable, and
// stop() unmounts it and returns what happened. What it logs is kept, not
// printed. For the video intro, timers (and the stand-in video's clock) run
// VIDEO_SPEED times faster, the native layout is stood in for (onLayout is
// called once it's on screen), and withTiming logs what it animates to and
// calls its callback, on the stand-in UI side, once its duration is up.
async function startSafeIntro(platform, { kind, overrides = {}, media = {}, reduceMotion = false }) {
  const calls = [];
  const playing = fs.readFileSync(safeIntroFile, 'utf8').replace(INTRO_KIND, (line) => line.replace(/'\w+';$/, `'${kind}';`));
  const video = kind === 'video';
  const speed = video ? VIDEO_SPEED : 1;
  const clock = () => performance.now() * speed;
  const runtime = new Runtime(platform, { overrides: { [safeIntroFile]: playing, ...overrides }, calls, media, clock });
  installGlobals(runtime);
  if (video) {
    const onUI = (worklet, ...args) => {
      const previous = global._WORKLET;
      global._WORKLET = true;
      try {
        return runtime.ui.toUI(worklet, 'a withTiming callback')(...args);
      } finally {
        global._WORKLET = previous;
      }
    };
    runtime.standIns['react-native-reanimated'] = {
      ...runtime.standIns['react-native-reanimated'],
      useReducedMotion: () => reduceMotion,
      withTiming: hostFunction((to, config, callback) => {
        calls.push(`withTiming ${to} ${config?.duration}`);
        if (callback) setTimeout(() => onUI(callback, true), config?.duration ?? 300);
        return to;
      }),
    };
  }
  await runtime.prepare(safeIntroFile);

  const logged = [];
  const uncaught = [];
  const real = { error: console.error, warn: console.warn, setTimeout: global.setTimeout };
  console.error = (...args) => logged.push(describe(args));
  console.warn = (...args) => logged.push(describe(args));
  global.setTimeout = (fn, ms = 0, ...args) => real.setTimeout(fn, ms / speed, ...args);
  const { render, container } = makeRenderer((error) => uncaught.push(error));
  const wait = (ms, until = () => false) => settle(ms / speed, () => until(calls));
  try {
    const { SafeIntro } = runtime.require(safeIntroFile);
    render(React.createElement(SafeIntro, { onFinish: () => calls.push('onFinish') }));
  } catch (error) {
    uncaught.push(error);
  }
  const nodes = (node) => [node, ...(node.children ?? []).flatMap(nodes)];
  const text = (node) => (node.text ?? '') + (node.children ?? []).map(text).join('');
  if (video) {
    await wait(500, () => container.children.length > 0);
    try {
      for (const node of nodes(container)) node.props?.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
    } catch (error) {
      uncaught.push(error);
    }
  }
  return {
    calls,
    wait,
    // 'Skip' (the button) or 'anywhere' (the rest of the screen).
    press(button) {
      const pressable = nodes(container).find(
        (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Skip the intro' && (text(node) === 'Skip') === (button === 'Skip'),
      );
      if (!pressable) throw new Error(`There's no Pressable to skip the intro with (${button}).`);
      calls.push(`pressed ${button}`);
      pressable.props.onPress();
    },
    async stop() {
      render(null);
      await wait(20);
      console.error = real.error;
      console.warn = real.warn;
      global.setTimeout = real.setTimeout;
      return { calls, logged, uncaught, fatal: runtime.fatal, problems: runtime.ui.problems };
    },
  };
}

// What every run of the intro must avoid: an error getting past SafeIntro,
// reaching the app's error handler, or a worklet that breaks on the UI side.
const healthy = ({ uncaught, fatal, problems }) => [
  ...(uncaught.length ? [`an error got past SafeIntro: ${uncaught[0]?.stack ?? uncaught[0]}`] : []),
  ...(fatal.length ? [`a fatal error reached the app's error handler: ${fatal[0]?.stack ?? fatal[0]}`] : []),
  ...problems.filter((p, i, all) => all.indexOf(p) === i),
];
const skipLogs = (logged) => logged.filter((line) => line.includes('Intro skipped after an error'));

// Per intro: how long it's given to fail, how long it's played for when it
// shouldn't, and what's forced (each a failure SafeIntro must turn into a
// skipped intro, apart from the first).
const SAFE_INTRO_CASES = {
  video: {
    failWithin: 12000,
    playFor: 5000,
    cases: [
      { name: 'plays normally', fails: false },
      {
        name: 'its module throws while loading',
        overrides: {
          [videoIntroFile]: `${fs.readFileSync(videoIntroFile, 'utf8')}
throw new Error('forced: video-intro.tsx failed to load');`,
        },
        fails: /forced: video-intro\.tsx failed to load/,
      },
      { name: 'rendering throws', media: { renderThrows: true }, fails: /forced: rendering failed/ },
      { name: "the video can't play", media: { fails: true }, fails: /forced: the video failed to play/ },
      { name: 'its first frame never shows (3 s)', media: { noFirstFrame: true }, fails: /first frame wasn't shown in time/ },
      { name: "it stalls, so it hasn't ended after 9 s", media: { stalls: true }, fails: /hadn't ended 9 s after it started/ },
    ],
  },
  skia: {
    failWithin: 2000,
    playFor: 500,
    cases: [
      { name: 'plays normally', fails: false },
      {
        name: 'a module throws while loading',
        overrides: {
          [path.join(introDir, 'world.ts')]: `${fs.readFileSync(path.join(introDir, 'world.ts'), 'utf8')}
throw new Error('forced: world.ts failed to load');`,
        },
        fails: /forced: world\.ts failed to load/,
      },
      {
        name: 'rendering throws',
        overrides: {
          [path.join(introDir, 'intro-journey.tsx')]: `export function IntroJourney() {
  throw new Error('forced: rendering failed');
}`,
        },
        fails: /forced: rendering failed/,
      },
      {
        name: 'drawing a frame throws on the UI thread',
        overrides: {
          [path.join(introDir, 'scene.ts')]: `export function createScene() {
  return function drawScene() {
    'worklet';
    throw new Error('forced: drawing a frame failed');
  };
}`,
        },
        fails: /forced: drawing a frame failed/,
      },
    ],
  },
};

// Plays SafeIntro (see startSafeIntro), takes `steps` on it, then stops it,
// whatever happened in them, and returns what happened.
async function playSafeIntro(platform, options, steps) {
  const intro = await startSafeIntro(platform, options);
  let failure;
  try {
    await steps(intro);
  } catch (error) {
    failure = error;
  }
  const result = await intro.stop();
  if (failure) result.problems.push(`the check couldn't take its steps: ${failure.message}`);
  return result;
}

async function checkSafeIntro(platform, kind) {
  const failures = [];
  const { failWithin, playFor, cases } = SAFE_INTRO_CASES[kind];
  for (const test of cases) {
    const result = await playSafeIntro(platform, { kind, overrides: test.overrides, media: test.media }, (intro) =>
      intro.wait(test.fails ? failWithin : playFor, (calls) => test.fails && calls.includes('onFinish')),
    );
    const { calls, logged } = result;
    const problems = healthy(result);
    const skipped = skipLogs(logged);
    const finished = calls.filter((c) => c === 'onFinish').length;
    if (test.fails) {
      if (!skipped.some((line) => test.fails.test(line))) problems.push(`the error wasn't logged as a skipped intro (logged: ${JSON.stringify(logged).slice(0, 300)})`);
      if (finished !== 1) problems.push(`onFinish was called ${finished} times, not once`);
      if (!calls.includes('SplashScreen.hide')) problems.push("the native splash wasn't hidden");
    } else {
      if (skipped.length) problems.push(`it was skipped: ${skipped[0]}`);
      if (finished) problems.push('onFinish was called before the intro finished');
      // It starts (and the splash comes down) once its first frame is shown.
      if (!calls.includes('SplashScreen.hide')) problems.push('it never started: its first frame was never reported shown');
    }
    console.log(`    ${problems.length ? 'FAIL' : 'ok  '} SafeIntro (${kind} intro), when ${test.name}`);
    failures.push(...problems.map((p) => `SafeIntro (${kind} intro), when ${test.name}: ${p}`));
  }
  return failures;
}

// Check 7: the video intro, playing (with the stand-in players) as it should.
const SOUND_MODE = { playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false };
// The hand-off into the app: a fade and a grow, over the same time, started
// this far into the video.
const HANDOFF = { atS: 6.6, ms: 650, scale: 1.6 };
const HANDOFF_FADE = `withTiming 0 ${HANDOFF.ms}`;
const HANDOFF_GROW = `withTiming ${HANDOFF.scale} ${HANDOFF.ms}`;

// What's wrong with the hand-off in `calls`, if it should have started at
// HANDOFF.atS from the video's time updates: it must start once (however
// many updates follow), at the first one at or past that time, before the
// video's end.
function handoffProblems(calls) {
  const problems = [];
  const times = calls.map((c) => (c.startsWith('video timeUpdate ') ? Number(c.slice('video timeUpdate '.length)) : undefined));
  if (times.every((t) => t === undefined)) {
    return ["the video never reported its time (timeUpdate), so nothing started the hand-off on time: is its timeUpdateEventInterval set?"];
  }
  const fades = calls.filter((c) => c === HANDOFF_FADE).length;
  const grows = calls.filter((c) => c === HANDOFF_GROW).length;
  const ran = `the animations it ran: ${[...new Set(calls.filter((c) => c.startsWith('withTiming ')))].join(', ') || 'none'}`;
  if (!fades && !grows) return [`the hand-off into the app (a fade, and a grow to ${HANDOFF.scale}×, over ${HANDOFF.ms} ms) didn't run (${ran})`];
  if (fades !== 1 || grows !== 1) {
    problems.push(
      `the hand-off didn't start exactly once (fades over ${HANDOFF.ms} ms: ${fades}, grows to ${HANDOFF.scale}× over ${HANDOFF.ms} ms: ${grows}` +
        (Math.max(fades, grows) > 1 ? `): the time updates after ${HANDOFF.atS} s must not start it again` : `; ${ran})`),
    );
  }
  const at = calls.indexOf(fades ? HANDOFF_FADE : HANDOFF_GROW);
  const end = calls.indexOf('video playToEnd');
  if (end >= 0 && end < at) {
    problems.push(`the hand-off started at the video's end (playToEnd), not ${HANDOFF.atS} s in`);
  } else {
    // The update that started it: at or past HANDOFF.atS, and no later than
    // the one after (the intro asks for one every 0.05 s).
    const before = times.slice(0, at).filter((t) => t !== undefined);
    const startedAt = before[before.length - 1];
    if (startedAt === undefined || startedAt < HANDOFF.atS - 1e-6 || startedAt > HANDOFF.atS + 0.06) {
      const when = startedAt === undefined ? 'before the video first reported its time' : `when the video was ${startedAt.toFixed(2)} s in`;
      problems.push(`the hand-off started ${when}, not about ${HANDOFF.atS} s in`);
    }
  }
  // Updates must keep coming after it, or "only once" proves nothing.
  if (!problems.length && !times.slice(at).some((t) => t !== undefined)) {
    problems.push("the video stopped reporting its time when the hand-off started, so this can't tell whether later updates would start it again");
  }
  if (calls.indexOf('onFinish') < at) problems.push('onFinish was called before the hand-off');
  return problems;
}

async function checkVideoIntro(platform) {
  const failures = [];
  const finished = (calls) => calls.includes('onFinish');
  const cases = [
    {
      name: 'it plays to the end',
      // Past the hand-off (and onFinish, at its end) to the video's end, with
      // the time updates still coming all the while.
      steps: (intro) => intro.wait(12000, (calls) => finished(calls) && calls.includes('video playToEnd')),
      expect: ({ calls }) => {
        const problems = [];
        const player = calls.videoPlayers?.[0];
        if (!player?.muted) problems.push("the video isn't muted");
        if (player?.loop) problems.push('the video loops');
        if (player?.audioMixingMode !== 'mixWithOthers') {
          problems.push(`the video's audioMixingMode is ${player?.audioMixingMode}, not mixWithOthers (on iOS it would stop other apps' audio)`);
        }
        const frame = calls.indexOf('video first frame');
        if (frame < 0) problems.push('its first frame was never shown');
        else if (calls.indexOf('SplashScreen.hide') < frame) problems.push("the splash didn't come down on the video's first frame");
        const started = calls.indexOf('video playingChange true');
        const sound = calls.indexOf('sound play()');
        if (started < 0) problems.push('the video never played');
        else if (sound < 0) problems.push('the sound never played');
        else if (sound < started) problems.push('the sound started before the video');
        else {
          const between = calls.slice(started, sound);
          const modes = between.filter((c) => c.startsWith('setAudioModeAsync '));
          if (!modes.length) {
            problems.push(
              "the sound's audio mode wasn't set between the video starting and the sound starting " +
                "(on iOS, the video's own mode, which ignores the silent switch, would be left in place)",
            );
          } else {
            const mode = JSON.parse(modes[modes.length - 1].slice('setAudioModeAsync '.length));
            for (const [key, value] of Object.entries(SOUND_MODE)) {
              if (mode[key] !== value) problems.push(`the sound's audio mode has ${key}: ${mode[key]}, not ${value}`);
            }
          }
          if (!between.includes('sound seekTo()')) problems.push("the sound wasn't moved to the picture's time before it started");
        }
        problems.push(...handoffProblems(calls));
        const end = calls.indexOf('video playToEnd');
        if (end < 0) problems.push('the video never reached its end');
        else if (!calls.includes('sound pause()', end)) problems.push("the sound didn't stop with the video");
        return problems;
      },
    },
    {
      name: 'its time updates never come',
      options: { media: { noTimeUpdates: true } },
      steps: (intro) => intro.wait(12000, finished),
      expect: ({ calls }) => {
        const problems = [];
        const end = calls.indexOf('video playToEnd');
        const fades = calls.filter((c) => c === HANDOFF_FADE).length;
        const grows = calls.filter((c) => c === HANDOFF_GROW).length;
        if (end < 0) problems.push('the video never reached its end');
        else if (!calls.includes(HANDOFF_FADE, end) || !calls.includes(HANDOFF_GROW, end)) {
          problems.push(`the video's end didn't start the hand-off (a fade, and a grow to ${HANDOFF.scale}×, over ${HANDOFF.ms} ms)`);
        }
        if (fades > 1 || grows > 1) problems.push(`the hand-off started more than once (faded ${fades} times, grew ${grows} times)`);
        return problems;
      },
    },
    ...['Skip', 'anywhere'].map((button) => ({
      name: button === 'Skip' ? 'Skip is pressed' : 'the screen is tapped',
      steps: async (intro) => {
        // Once it's started (the splash is down) and the sound is playing.
        await intro.wait(3000, (calls) => calls.includes('SplashScreen.hide') && calls.includes('sound play()'));
        intro.press(button);
        await intro.wait(2000, finished);
      },
      expect: ({ calls }) => {
        const problems = [];
        const pressed = calls.indexOf(`pressed ${button}`);
        if (!calls.includes('video pause()', pressed)) problems.push("the video wasn't paused");
        if (!calls.includes('sound pause()', pressed)) problems.push("the sound wasn't paused");
        if (calls.includes('sound play()', pressed)) problems.push('the sound started again');
        if (!calls.includes('withTiming 0 300', pressed)) problems.push("it didn't fade out over 300 ms");
        if (calls.some((c) => c.startsWith(`withTiming ${HANDOFF.scale} `))) problems.push('it grew, as it does at the hand-off into the app');
        return problems;
      },
    })),
    {
      name: 'Reduce Motion is on',
      options: { reduceMotion: true },
      steps: (intro) => intro.wait(2000, finished),
      expect: ({ calls }) => {
        const problems = [];
        if (!calls.includes('video created with no source')) problems.push('the video was loaded');
        if (calls.includes('sound created')) problems.push('the sound was loaded');
        if (calls.includes('video play()')) problems.push('the video played');
        if (!calls.includes('SplashScreen.hide')) problems.push("the splash wasn't hidden");
        if (!calls.includes('withTiming 0 350')) problems.push("it didn't fade onto the app over 350 ms");
        return problems;
      },
    },
    {
      name: "its sound can't load",
      options: { media: { noSound: true } },
      steps: (intro) => intro.wait(12000, finished),
      expect: ({ calls, logged }) => {
        const problems = [];
        if (!calls.includes(HANDOFF_GROW)) problems.push("the video didn't play on to the hand-off into the app");
        if (!logged.some((line) => line.includes('Intro sound unavailable'))) problems.push("the missing sound wasn't logged");
        return problems;
      },
    },
  ];

  for (const test of cases) {
    const result = await playSafeIntro(platform, { kind: 'video', ...test.options }, test.steps);
    const problems = healthy(result);
    const skipped = skipLogs(result.logged);
    if (skipped.length) problems.push(`it was skipped: ${skipped[0]}`);
    const finishes = result.calls.filter((c) => c === 'onFinish').length;
    if (finishes !== 1) problems.push(`onFinish was called ${finishes} times, not once`);
    problems.push(...test.expect(result));
    console.log(`    ${problems.length ? 'FAIL' : 'ok  '} video intro, when ${test.name}`);
    failures.push(...problems.map((p) => `Video intro, when ${test.name}: ${p}`));
  }
  return failures;
}

// ---------------------------------------------------------------------------

async function main() {
  const platforms = process.argv.slice(2).filter((a) => ['ios', 'android'].includes(a));
  let failed = false;
  console.log(`The intro played on launch: ${launchKind()} (INTRO_KIND in safe-intro.tsx). Both intros are checked.`);
  for (const platform of platforms.length ? platforms : ['ios', 'android']) {
    console.log(`\n${platform}`);
    const started = Date.now();
    const { failures, modules, frames } = await checkLoading(platform);
    console.log(`    ${failures.length ? 'FAIL' : 'ok  '} ${modules} intro modules transformed and loaded, ${frames} frames drawn on the UI side`);
    failures.push(...(await checkSafeIntro(platform, 'video')));
    failures.push(...(await checkVideoIntro(platform)));
    failures.push(...(await checkSafeIntro(platform, 'skia')));
    failures.push(...(await checkAdaptive(platform)));
    failures.push(...(await checkLaunch(platform)));
    if (failures.length) {
      failed = true;
      console.error(`\n  ${failures.length} problem${failures.length === 1 ? '' : 's'} on ${platform}:\n`);
      for (const failure of failures) console.error(`  ✗ ${failure.replace(/\n/g, '\n    ')}\n`);
    }
    console.log(`    (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
  console.log(failed ? '\nIntro check FAILED: fix these before testing on a phone.' : '\nIntro check passed.');
  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { Runtime, installGlobals, transform, checkLoading, checkSafeIntro, checkVideoIntro, checkAdaptive, checkLaunch };

# Intro video source

The app's intro is a pre-rendered video (`assets/intro/intro.mp4`, silent) plus a separate sound file
(`assets/intro/intro-sound.m4a`). This folder holds what they were made from, so the intro can be edited and re-rendered.

- `scene.html` is the whole intro as a three.js scene: a brass compass is set down on a folded topo map of Canoe Lake
  (Algonquin), the lid opens, the needle swings, the "GoOutside" letters (cut from Marcellus) fall onto the map, then the
  camera dives into the dial, which is the GoOutside seal (`assets/logo/gooutside-compass-gold.svg`) in gold on pine.
  The fonts (Marcellus, Cormorant Garamond, Inter) and the logo are embedded, so the page works offline apart from three.js.
  The scene renders to a linear HDR target, then one post pass does depth of field, bloom, filmic tone and vignette.
  There's no film grain on purpose: video compression smears it and makes detail flicker. The `hqdn3d` step in the
  encode smooths sparkle on the brass between frames, and the x264 settings keep detail steady from frame to frame. Open it in a browser to play, scrub, or hear it.
  Every frame is a pure function of time `t` (see `frame(t)`), and the sound cues are in the `cues` list.
- `render_frames.py` renders 223 frames (30 fps, 7.4 s) at 1170x2532.
- `bake_textures.py` is left over from the earlier version and no longer works with this scene; it can be deleted.
- `render_audio.py` renders the sound effects offline to a WAV.

Render (PowerShell, from this folder; needs Python, `pip install playwright`, `playwright install chromium`, and ffmpeg):

    python render_frames.py frames
    python render_audio.py intro.wav
    ffmpeg -y -framerate 30 -i frames/f%04d.png -vf "hqdn3d=0:0:4:4" -c:v libx264 -preset slow -crf 23 -x264-params "pbratio=1.0:ipratio=1.1:aq-mode=3" -pix_fmt yuv420p -movflags +faststart -an ..\..\assets\intro\intro.mp4
    ffmpeg -y -i intro.wav -af "atrim=0:7.4" -c:a aac -b:a 128k ..\..\assets\intro\intro-sound.m4a

To change the timing, edit `frame(t)` and the cue times together. The compass ticks (`watchBeat`) are cued at 2.2-3.3 s and
4.0-5.1 s, matching the needle swing and the dial turn. The last 0.3 s of the video is a held frame of the dial; the app
fades its own screen in over that.

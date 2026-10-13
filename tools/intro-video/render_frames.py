"""Renders every frame of the intro to PNG at iPhone resolution (1170x2532).
Usage:  python render_frames.py <out_dir> [part] [nparts]
Run two or more parts in parallel to go faster, e.g. 'python render_frames.py frames 0 2' and '... 1 2'.
Frames that already exist are skipped, so it can be re-run after a stop.
Needs: pip install playwright ; playwright install chromium. Internet is needed (three.js loads from a CDN;
the fonts and the logo are embedded in scene.html)."""
import sys, os, base64, pathlib
from playwright.sync_api import sync_playwright
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
part = int(sys.argv[2]) if len(sys.argv) > 2 else 0
nparts = int(sys.argv[3]) if len(sys.argv) > 3 else 1
FPS, SECONDS = 30, 7.4
N = int(SECONDS * FPS) + 1
scene = pathlib.Path(__file__).with_name('scene.html').resolve().as_uri()
todo = [i for i in range(part, N, nparts) if not (out / f"f{i:04d}.png").exists()]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=3)
    pg.set_default_timeout(600000)
    pg.goto(scene, wait_until="load")
    pg.wait_for_function("window.__ready === true")   # fonts, logo and the map are built in the page first
    pg.evaluate("window.__render()")                  # sizes the stage to 390x844 and enables 3x rendering
    for i in todo:
        url = pg.evaluate(f"window.__grab({i / FPS})")  # draws frame t and returns the canvas as PNG
        (out / f"f{i:04d}.png").write_bytes(base64.b64decode(url.split(',')[1]))
        print(i, flush=True)
    b.close()

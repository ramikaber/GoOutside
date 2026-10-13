"""Exports the scene's generated textures (map, dial, lid engraving, glass scratches, brass/steel matcaps...) as image files
for the native live intro, which has no 2D canvas to make them on the phone.
Usage:  python bake_textures.py <out_dir>        (needs: pip install playwright pillow ; playwright install chromium)
Then copy the files to assets/intro/tex/."""
import sys, os, base64, pathlib
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFilter
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
scene = pathlib.Path(__file__).with_name('scene.html').resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 820, "height": 720})
    pg.goto(scene, wait_until="load", timeout=90000); pg.wait_for_timeout(3000)
    res = pg.evaluate("window.__bake()")
    res['matcap-brass'] = pg.evaluate("window.__matcap('brass')")
    res['matcap-steel'] = pg.evaluate("window.__matcap('steel')")
    b.close()
raw = out / '_raw'; raw.mkdir(exist_ok=True)
for k, v in res.items():
    (raw / f'{k}.png').write_bytes(base64.b64decode(v.split(',')[1]))
def rgb(p):
    im = Image.open(p)
    if im.mode == 'RGB': return im
    bg = Image.new('RGB', im.size, (0, 0, 0)); bg.paste(im, mask=im.split()[-1] if im.mode == 'RGBA' else None); return bg
rgb(raw/'map.png').resize((2048, 2048), Image.LANCZOS).save(out/'map.jpg', quality=88, optimize=True)
Image.open(raw/'bump.png').convert('L').resize((512, 512), Image.LANCZOS).save(out/'bump.png', optimize=True)
rgb(raw/'dial.png').save(out/'dial.jpg', quality=92, optimize=True)
rgb(raw/'lid.png').save(out/'lid.jpg', quality=90, optimize=True)
Image.open(raw/'scratch.png').convert('RGBA').resize((1024, 1024)).save(out/'scratch.png', optimize=True)
Image.open(raw/'streak.png').convert('RGBA').resize((256, 256), Image.LANCZOS).save(out/'streak.png', optimize=True)
Image.open(raw/'dust.png').convert('RGBA').save(out/'dust.png', optimize=True)
for k in ('brass', 'steel'):
    Image.open(raw/f'matcap-{k}.png').convert('RGB').save(out/f'matcap-{k}.jpg', quality=94)
N = 128; im = Image.new('L', (N, N), 0); ImageDraw.Draw(im).ellipse((N*.18, N*.18, N*.82, N*.82), fill=255); im = im.filter(ImageFilter.GaussianBlur(N*.12))
rgba = Image.new('RGBA', (N, N), (20, 30, 20, 0)); rgba.putalpha(im.point(lambda v: int(v*.85))); rgba.save(out/'blob.png', optimize=True)
print('done:', sorted(f.name for f in out.iterdir() if f.is_file()))

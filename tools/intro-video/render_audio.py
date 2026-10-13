"""Renders the intro's sound effects offline to intro.wav (44.1 kHz mono). Usage: python render_audio.py intro.wav"""
import sys, wave, struct, pathlib
from playwright.sync_api import sync_playwright
scene = pathlib.Path(__file__).with_name('scene.html').resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 420, "height": 900})
    pg.goto(scene, wait_until="load", timeout=90000)
    pg.wait_for_timeout(2000)
    data = pg.evaluate("window.__renderAudio()")
    b.close()
data = [0 if x is None else int(x) for x in data]
w = wave.open(sys.argv[1], "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
w.writeframes(struct.pack("<%dh" % len(data), *data)); w.close()
print(len(data) / 44100, "seconds")

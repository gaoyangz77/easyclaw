"""Resize the DMG background image to 590x380 @72dpi (1x, non-Retina)."""

from PIL import Image

src = "apps/desktop/build/dmg-background.png"
img = Image.open(src)
print(f"Before: {img.size}, DPI: {img.info.get('dpi')}")

img = img.resize((590, 380), Image.LANCZOS)
img.save(src, dpi=(72, 72))
print(f"After:  (590, 380), DPI: (72, 72)")

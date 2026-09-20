# Noto Sans JP

`NotoSansJP-Regular.ttf` is a static weight-400 instance of Noto Sans JP from
Noto CJK Sans 2.004. All source glyphs are retained, including Japanese name
variants such as 髙, 﨑 and 𠮷. The bundled font is not intended to cover every
Unicode character (for example, arbitrary emoji).

- Source: https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf
- Source SHA-256: `f4b373b226668ee33a6e54b02823dcd2d1209f17159f777421ae8c2275160369`
- Bundled SHA-256: `c10cd926b33c2c45131e688418a98d88ddddef48f16f3df7fef2d560138e88fa`
- License: SIL Open Font License 1.1; see `OFL.txt` (upstream `LICENSE`).

## Reproducing the static font

The following was run with FontTools 4.53.0 against the source file above.
FontTools is only needed when regenerating this checked-in asset, not during
application installation or deployment.

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont('NotoSansJP-VF.ttf', recalcTimestamp=False)
instantiateVariableFont(font, {'wght': 400}, inplace=True, updateFontNames=True)
# Align glyphs so fontkit's short loca offsets remain valid after subsetting.
font['glyf'].padding = 4
font.save('NotoSansJP-Regular.ttf')
```

The font is deployed as a static asset and loaded through the Workers ASSETS
binding. Only glyphs used in a report are embedded in that PDF. PDF generation
does not fetch a font from an external CDN. Keep the license with the font when
updating it.

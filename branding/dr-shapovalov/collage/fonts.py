"""Fetches Manrope (SIL Open Font License) from Google Fonts into a local cache."""
import os, re, urllib.request

CACHE = os.path.join(os.path.dirname(__file__), '.fonts')
FALLBACK = '/usr/share/fonts/truetype/dejavu/DejaVuSans{}.ttf'

def manrope(weight):
    path = os.path.join(CACHE, f'Manrope-{weight}.ttf')
    if os.path.exists(path):
        return path
    os.makedirs(CACHE, exist_ok=True)
    try:
        # A plain User-Agent makes Google Fonts serve full TTF files instead of subset WOFF2.
        css = urllib.request.urlopen(
            f'https://fonts.googleapis.com/css2?family=Manrope:wght@{weight}', timeout=20).read().decode()
        url = re.search(r'url\((https://[^)]+\.ttf)\)', css).group(1)
        urllib.request.urlretrieve(url, path)
        return path
    except Exception as e:
        print(f'Manrope {weight} unavailable ({e}); using DejaVu Sans')
        return FALLBACK.format('-Bold' if weight >= 700 else '')

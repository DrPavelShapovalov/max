"""Скачивает шрифты с кириллицей в .fonts/ (Google Fonts, SIL OFL)."""
import re, pathlib, urllib.request
FONTS = {'Oswald-700': 'Oswald:wght@700', 'Oswald-500': 'Oswald:wght@500',
         'Cormorant-600i': 'Cormorant+Garamond:ital,wght@1,600',
         'Manrope-700': 'Manrope:wght@700', 'Manrope-500': 'Manrope:wght@500'}
out = pathlib.Path(__file__).resolve().parent / '.fonts'
out.mkdir(exist_ok=True)
for name, q in FONTS.items():
    css = urllib.request.urlopen(f'https://fonts.googleapis.com/css2?family={q}', timeout=30).read().decode()
    urllib.request.urlretrieve(re.search(r'url\((https://[^)]+\.ttf)\)', css).group(1), out / f'{name}.ttf')
    print('ok', name)

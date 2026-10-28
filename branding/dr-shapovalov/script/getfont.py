import re, sys, urllib.request
for fam in sys.argv[1:]:
    css = urllib.request.urlopen(f'https://fonts.googleapis.com/css2?family={fam.replace(" ", "+")}', timeout=20).read().decode()
    url = re.search(r'url\((https://[^)]+\.ttf)\)', css).group(1)
    urllib.request.urlretrieve(url, f'.fonts/{fam.replace(" ", "")}.ttf')
    print('ok', fam)

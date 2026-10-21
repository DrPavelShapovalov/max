"""Визитка 90×50 мм с QR-кодами на отзывы. Запуск: python3 make_card.py
Выход: card-print.pdf (2 страницы, вылеты 2 мм), card-front.png, card-back.png (600 dpi)."""
import base64, pathlib, segno
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
FONTS = {
    'Manrope': [(500, ROOT/'collage/.fonts/Manrope-500.ttf'), (700, ROOT/'collage/.fonts/Manrope-700.ttf'),
                (800, ROOT/'collage/.fonts/Manrope-800.ttf')],
    'Cormorant': [(600, ROOT/'script/.fonts/CormorantGaramond-600.ttf')],
}
PRODOCTOROV = 'https://prodoctorov.ru/moskva/vrach/928950-shapovalov/'
CNIIS = ('https://cniis.ru/specialists/otdelenie-khirurgicheskogo-lecheniya-anomaliy-'
         'cherepno-chelyustno-litsevoy-oblasti/shapovalov-pavel-igorevich/')
BLEED = 2  # мм

def font_css():
    out = []
    for fam, faces in FONTS.items():
        for w, p in faces:
            b64 = base64.b64encode(p.read_bytes()).decode()
            out.append(f"@font-face{{font-family:'{fam}';font-weight:{w};src:url(data:font/ttf;base64,{b64})}}")
    return '\n'.join(out)

def qr_svg(url):
    q = segno.make(url, error='m', micro=False)
    return q.svg_inline(scale=1, border=0, dark='#16181A', light=None, omitsize=True)

MARK = ('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2.6"/>'
        '<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M31 29V62"/><path d="M48 29V62"/><path d="M65 29V62"/><path d="M25 64H71"/></g>'
        '<circle cx="76" cy="71" r="5" fill="currentColor"/></svg>')

HTML = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
{font_css()}
@page {{ size: {90+2*BLEED}mm {50+2*BLEED}mm; margin: 0; }}
* {{ box-sizing: border-box; margin: 0; }}
html, body {{ font-family: 'Manrope', sans-serif; color: #16181A; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.page {{ width: {90+2*BLEED}mm; height: {50+2*BLEED}mm; padding: {BLEED}mm; position: relative; overflow: hidden; page-break-after: always; }}
.card {{ width: 90mm; height: 50mm; position: relative; }}
.front {{ background: #FFFFFF; }}
.back  {{ background: #F4F3F0; }}
.gold {{ color: #A27A30; }}

/* лицевая сторона */
.f {{ position: absolute; inset: 0; padding: 6mm 6.5mm; display: flex; flex-direction: column; }}
.f .mark {{ width: 7.5mm; height: 7.5mm; color: #16181A; }}
.f .name {{ margin-top: 3.4mm; font-family: 'Cormorant'; font-weight: 600; font-size: 15.5pt; line-height: 1; }}
.f .name span {{ color: #A27A30; }}
.f .role {{ margin-top: 1.6mm; font-size: 7pt; font-weight: 700; }}
.f .org {{ margin-top: .6mm; font-size: 6.3pt; font-weight: 500; color: #5E5B55; line-height: 1.35; }}
.f .rule {{ margin-top: auto; height: .25mm; background: #A27A30; width: 14mm; }}
.f .links {{ margin-top: 2mm; display: flex; gap: 5mm; font-size: 6.3pt; font-weight: 700; }}
.f .links i {{ font-style: normal; font-weight: 500; color: #8A8781; margin-right: 1mm; }}

/* оборот */
.b {{ position: absolute; inset: 0; padding: 4.6mm 5mm 4.2mm; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr; column-gap: 3mm; }}
.b .head {{ grid-column: 1 / -1; text-align: center; }}
.b h1 {{ font-family: 'Cormorant'; font-weight: 600; font-size: 13pt; line-height: 1; }}
.b .sub {{ margin-top: .9mm; font-size: 5.6pt; font-weight: 500; color: #5E5B55; }}
.q {{ display: flex; align-items: center; gap: 2mm; align-self: center; min-width: 0; }}
.q .tile {{ flex: none; width: 20.5mm; height: 20.5mm; padding: 1.5mm; background: #fff; border-radius: 1.6mm; }}
.q .tile svg {{ width: 100%; height: 100%; display: block; shape-rendering: crispEdges; }}
.q .t {{ min-width: 0; }}
.q .t b {{ display: block; font-size: 6.4pt; font-weight: 800; line-height: 1.15; }}
.q .t span {{ display: block; margin-top: .7mm; font-size: 5.2pt; font-weight: 500; color: #5E5B55; line-height: 1.3; }}
</style></head><body>

<div class="page front"><div class="card"><div class="f">
  <div class="mark">{MARK}</div>
  <div class="name">Шаповалов <span>Павел Игоревич</span></div>
  <div class="role">Челюстно-лицевой хирург, кандидат медицинских наук</div>
  <div class="org">ФГБУ НМИЦ «ЦНИИСиЧЛХ», Москва</div>
  <div class="rule"></div>
  <div class="links"><span><i>Telegram</i>t.me/SHAPOVALOV_DR</span><span><i>Instagram</i>@dr__shapovalov</span></div>
</div></div></div>

<div class="page back"><div class="card"><div class="b">
  <div class="head">
    <h1>Оставьте, пожалуйста, <span class="gold">отзыв</span></h1>
    <div class="sub">Ваш отзыв помогает другим пациентам выбрать врача. Спасибо!</div>
  </div>
  <div class="q"><div class="tile">{qr_svg(PRODOCTOROV)}</div>
    <div class="t"><b>ПроДокторов</b><span>Наведите камеру телефона на код</span></div></div>
  <div class="q"><div class="tile">{qr_svg(CNIIS)}</div>
    <div class="t"><b>Сайт<br>ЦНИИСиЧЛХ</b><span>Форма отзыва внизу страницы</span></div></div>
</div></div></div>

</body></html>"""

CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

def chrome(*args):
    subprocess.run([CHROME, '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                    '--no-pdf-header-footer', *args], check=True, capture_output=True, timeout=120)

def main():
    html = HERE / 'card.html'
    html.write_text(HTML, encoding='utf-8')
    chrome(f'--print-to-pdf={HERE / "card-print.pdf"}', html.as_uri())
    # PNG 600 dpi без вылетов — растр из того же PDF
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(HERE / 'card-print.pdf'))
    cut = round(BLEED / 25.4 * 600)
    for i, name in enumerate(('front', 'back')):
        im = pdf[i].render(scale=600 / 72).to_pil().convert('RGB')
        im = im.crop((cut, cut, im.width - cut, im.height - cut))
        im.save(HERE / f'card-{name}.png', dpi=(600, 600))
    html.unlink()


if __name__ == '__main__':
    main()

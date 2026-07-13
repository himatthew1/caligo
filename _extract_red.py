import re

with open('tut_unpacked/word/document.xml', 'r', encoding='utf-8') as f:
    content = f.read()

paras = re.split(r'<w:p[ >]', content)
red_paras = []
for i, para in enumerate(paras):
    colors = re.findall(r'<w:color w:val="([^"]+)"', para)
    red_colors = [c for c in colors if c.upper() in ('EE0000','BB0000','FF0000','CC0000','DD0000','AA0000')]
    if red_colors:
        texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', para, re.DOTALL)
        full_text = ''.join(texts).strip()
        if full_text:
            red_paras.append(full_text)

print(f'Found {len(red_paras)} red paragraphs')
for idx, t in enumerate(red_paras):
    print(f'{idx+1}. {t[:300]}')
    print()

"""Шаг 1: каждый кусок → work/seg/NN.mp4 (1080×1920, 30 к/с, H.264, без звука, сочнее цвет, размытие мониторов)."""
import subprocess, os, sys
from segments import SEGS, FPS, W, H
os.makedirs('work/seg', exist_ok=True)
for i, s in enumerate(SEGS):
    out = f'work/seg/{i:02d}.mp4'
    if os.path.exists(out) and '--force' not in sys.argv: continue
    base = (f'scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},fps={FPS},setsar=1,'
            'eq=saturation=1.22:contrast=1.05:brightness=0.015,unsharp=5:5:0.4')
    if s.get('speed'): base += f",setpts=PTS/{s['speed']}"
    if s.get('blur_top'):                     # мягкая граница: маска-градиент, а не резкий прямоугольник
        y0, y1 = s['blur_top']
        vf = (f"[0:v]{base},split[a][b];[b]boxblur=40:3,format=yuva420p[bl];"
              f"color=black:s={W}x{H}:r={FPS},format=gray,geq=lum='255*clip(({y1}-Y)/({y1}-{y0}),0,1)'[m];"
              f"[bl][m]alphamerge[blm];[a][blm]overlay=0:0:shortest=1,format=yuv420p[v]")
    elif s.get('blur'):
        x, y, w, h = s['blur'][0]
        vf = f'[0:v]{base},split[a][b];[b]crop={w}:{h}:{x}:{y},boxblur=40:3[bl];[a][bl]overlay={x}:{y},format=yuv420p[v]'
    else:
        vf = f'[0:v]{base},format=yuv420p[v]'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(s['ss']), '-t', str(s['d']), '-i', f"src/{s['f']}.mov",
                    '-filter_complex', vf, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', out], check=True)
    print(out)

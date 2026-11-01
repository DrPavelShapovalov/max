"""Шаг 2: финальная карточка (последний кадр, размыт и затемнён) + склейка всех кусков переходами xfade → work/base.mp4."""
import subprocess
from segments import SEGS, TRANS, T, FINAL, FPS, timeline
n = len(SEGS)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-sseof', '-0.1', '-i', f'work/seg/{n-1:02d}.mp4', '-frames:v', '1', 'work/last.png'], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-t', str(FINAL + T), '-i', 'work/last.png', '-vf',
                f"fps={FPS},boxblur=30:2,eq=brightness=-0.28:saturation=1.3,format=yuv420p", '-c:v', 'libx264', '-crf', '16', 'work/seg/final.mp4'], check=True)
files = [f'work/seg/{i:02d}.mp4' for i in range(n)] + ['work/seg/final.mp4']
st, total = timeline()
inp = sum((['-i', f] for f in files), [])
fl, prev = [], '[0:v]'
for i in range(1, len(files)):
    tr = TRANS[i - 1] if i - 1 < len(TRANS) else 'dissolve'
    off = (st[i] if i < n else st[-1] + SEGS[-1]['d'] / SEGS[-1].get('speed', 1) - T)
    lab = f'[x{i}]'
    fl.append(f'{prev}[{i}:v]xfade=transition={tr}:duration={T}:offset={off:.3f}{lab}')
    prev = lab
subprocess.run(['ffmpeg', '-v', 'error', '-y', *inp, '-filter_complex', ';'.join(fl), '-map', prev, '-c:v', 'libx264', '-preset', 'medium',
                '-crf', '16', '-pix_fmt', 'yuv420p', '-r', str(FPS), 'work/base.mp4'], check=True)
print('work/base.mp4', round(total, 2))

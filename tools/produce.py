"""One-time original asset production. Never invoked by the application build.

Requires the six authoring binaries provided in the production environment.
Polygon facets are rasterized into native pixel scanlines, then rendered by draw.
"""

import json
import math
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets"
TMP = Path("/tmp/opencode/facet-production")
TMP.mkdir(parents=True, exist_ok=True)
for folder in ["gems", "audio", "fx"]:
    (OUT / folder).mkdir(parents=True, exist_ok=True)


def run(tool, *args):
    subprocess.run([tool, *map(str, args)], check=True, capture_output=True, cwd=TMP)


def write(path, value):
    path.write_text(json.dumps(value))


def line(ops, a, b, color):
    ops.append(dict(op="line", x0=round(a[0]), y0=round(a[1]),
                    x1=round(b[0]), y1=round(b[1]), color=color))


def poly(ops, points, color):
    for y in range(math.ceil(min(p[1] for p in points)), math.ceil(max(p[1] for p in points))):
        xs = []
        for a, b in zip(points, points[1:] + points[:1]):
            if (a[1] <= y < b[1]) or (b[1] <= y < a[1]):
                xs.append(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            line(ops, (math.ceil(xs[i]), y), (math.floor(xs[i + 1]), y), color)


def shade(hexcolor, amount):
    rgb = [int(hexcolor[i:i+2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{max(0, min(255, round(c * amount))):02x}" for c in rgb)


KINDS = ["ruby", "amber", "citrine", "jade", "beryl", "sapphire", "amethyst", "prism"]
COLORS = ["#ef5877", "#f6a452", "#e5d567", "#65d3a0", "#5ad9db", "#7098f3", "#c68ced", "#e6e8ef"]
SHAPES = [
    [(32, 4), (54, 18), (54, 43), (32, 59), (10, 43), (10, 18)],
    [(19, 9), (45, 9), (58, 31), (45, 54), (19, 54), (6, 31)],
    [(32, 3), (57, 48), (32, 57), (7, 48)],
    [(20, 7), (44, 7), (55, 19), (55, 44), (44, 56), (20, 56), (9, 44), (9, 19)],
    [(32, 3), (55, 31), (32, 60), (9, 31)],
    [(18, 8), (46, 8), (57, 22), (50, 47), (32, 58), (14, 47), (7, 22)],
    [(32, 4), (52, 15), (58, 35), (43, 54), (21, 54), (6, 35), (12, 15)],
    [(32, 3), (52, 13), (59, 32), (50, 51), (32, 60), (14, 51), (5, 32), (12, 13)],
]


def gem(k, strain=0, turn=0):
    ops = []
    points = SHAPES[k]
    if turn:
        points = [(32 + (x-32) * (0.77 + 0.23*math.cos(turn)), y) for x,y in points]
    base = COLORS[k]
    poly(ops, points, "#071b26")
    inner = [(32 + (x-32)*0.91, 32 + (y-32)*0.91) for x,y in points]
    table = [(32 + (x-32)*0.51, 30 + (y-32)*0.48) for x,y in points]
    for j in range(len(points)):
        nxt = (j+1) % len(points)
        color = shade(base, [1.22, 0.72, 0.48, 0.62, 0.88, 1.12, 1.3, 1.05][j])
        if k == 7:
            color = COLORS[(j + int(turn*2)) % 7]
        poly(ops, [inner[j], inner[nxt], table[nxt], table[j]], color)
    poly(ops, table, shade(base, 1.06))
    # Interior facets make the kinds identifiable beyond silhouette or color.
    if k in (0, 4, 7):
        poly(ops, [table[0], table[1], (32, 38)], shade(base, 1.3))
        poly(ops, [table[-1], table[0], (32, 38)], shade(base, 0.83))
    else:
        line(ops, table[0], table[len(table)//2], shade(base, 0.80))
        line(ops, table[1], table[-1], shade(base, 1.3))
    for j in range(len(table)):
        line(ops, table[j], table[(j+1)%len(table)], shade(base, 1.24))
    for j in range(min(3, len(inner)-1)):
        line(ops, inner[j], inner[j+1], "#f4f7dd" if j == 0 else shade(base, 1.35))
    line(ops, (17, 20), (22, 20), "#ffffff")
    line(ops, (19, 18), (19, 22), "#ffffff")
    cracks = [[(34, 9), (28, 23), (35, 30), (25, 43), (30, 54)],
              [(12, 31), (28, 34), (38, 24), (51, 27)],
              [(18, 15), (27, 25), (22, 33), (37, 42), (47, 49)]]
    for crack in cracks[:strain]:
        for a,b in zip(crack, crack[1:]):
            line(ops, (a[0]+1,a[1]), (b[0]+1,b[1]), "#e5f5e9" if strain<3 else "#fff3c3")
            line(ops, a, b, "#12222d" if strain<3 else "#fff2c5")
    if strain == 3:
        for a,b in zip(points, points[1:]+points[:1]):
            line(ops, a,b,"#ffe4a0")
        for x,y in [(25,24),(37,39),(22,36)]:
            poly(ops, [(x,y),(x+4,y-2),(x+2,y+4)], "#10212b")
    return ops


def render(ops, path, tool="draw", w=64, h=64):
    path.parent.mkdir(parents=True, exist_ok=True)
    log = TMP / "pixels.json"
    write(log, ops)
    run(tool, "render", "--actions", log, "--out", path, "--width", w, "--height", h, "--no-layers")


for k,name in enumerate(KINDS):
    for strain in range(4):
        render(gem(k,strain), OUT / f"gems/{name}-{strain}.png")
    if k<7:
        for frame in range(6):
            ops=[]
            # Each faceted shard travels out from its own center, shrinking away.
            for j in range(7):
                ang=j*math.tau/7 + k*.23
                distance=frame*5.8
                cx=32+math.cos(ang)*distance
                cy=32+math.sin(ang)*distance+frame*frame*.30
                r=max(1,12-frame*1.9)
                pts=[(cx+math.cos(ang+t)*r,cy+math.sin(ang+t)*r) for t in (0,2.2,4.1)]
                poly(ops,pts,shade(COLORS[k],[1.3,.8,1.1,.6,1.2,.9,.7][j]))
                line(ops,pts[0],pts[1],shade(COLORS[k],1.4))
            render(ops,OUT/f"gems/break/{name}/{frame}.png","draw-sheet")
for frame in range(12):
    render(gem(7,turn=frame*math.tau/12),OUT/f"gems/prism-turn/{frame}.png","draw-sheet")

for name in ["brilliant","star"]:
    ops=[]
    if name == "brilliant":
        for r in (25,28):
            pts=[(32+math.cos(j*math.tau/8)*r,32+math.sin(j*math.tau/8)*r) for j in range(8)]
            for a,b in zip(pts,pts[1:]+pts[:1]): line(ops,a,b,"#fff2bb")
        poly(ops,[(32,19),(38,32),(32,45),(26,32)],"#fff6d2")
        poly(ops,[(32,25),(35,32),(32,39),(29,32)],"#b98448")
    else:
        for j in range(4):
            a=j*math.pi/2
            pts=[(32+math.cos(a)*28,32+math.sin(a)*28),
                 (32+math.cos(a+.65)*9,32+math.sin(a+.65)*9),
                 (32,32),(32+math.cos(a-.65)*9,32+math.sin(a-.65)*9)]
            poly(ops,pts,"#fff6da")
        poly(ops,[(32,25),(39,32),(32,39),(25,32)],"#a4784c")
    render(ops,OUT/f"gems/{name}.png")

# A complete engraved bench surround, including the recessed checker field.
ops=[]
for inset,color in [(0,"#09161f"),(2,"#745f46"),(3,"#b29965"),(5,"#263d40"),(9,"#142b32"),(13,"#806a48"),(14,"#061921")]:
    poly(ops,[(inset,inset),(608-inset,inset),(608-inset,608-inset),(inset,608-inset)],color)
for row in range(8):
    for col in range(8):
        x,y=16+col*72,16+row*72
        poly(ops,[(x,y),(x+71,y),(x+71,y+71),(x,y+71)],"#102a32" if (row+col)%2==0 else "#0d242d")
        line(ops,(x+8,y+71),(x+63,y+71),"#17333a")
        for dx,dy in [(3,3),(68,3),(3,68),(68,68)]:
            line(ops,(x+dx,y+dy),(x+dx,y+dy),"#34504c")
for x,y in [(7,7),(601,7),(7,601),(601,601)]:
    poly(ops,[(x,y-4),(x+4,y),(x,y+4),(x-4,y)],"#ebd7a1")
render(ops,OUT/"gems/board-frame.png",w=608,h=608)


def config(tool,name,duration=700):
    data=dict(sample_rate=22050,channels="stereo",max_duration_ms=duration,seed=71,
              actions=str(TMP/f"{name}-ops.json"),preview=str(TMP/f"{name}.png"),
              wav=str(OUT/f"audio/{name}.wav"))
    if tool=="music":
        data.update(instrument_bank="gm-lite",mid=str(OUT/f"audio/{name}.mid"))
    if tool=="sfx-sample": data["sample_pack"]="combat-core"
    path=TMP/f"{name}.json"
    write(path,data)
    run(tool,"--config",path,"init")
    return path


def op(tool,cfg,*args): run(tool,"--config",cfg,*args)


for name,freq,dur,wave,end in [
    ("select",920,75,"sine",1200),("swap",470,140,"triangle",830),
    ("refuse",160,130,"triangle",75),("land",95,170,"sine",48),
    ("flaw",2100,80,"noise",600),("cut",1400,360,"sine",2100),
    ("levelup",523,650,"sine",1046),("gameover",440,700,"triangle",110),
]+[(f"chain-{i+1}",freq,260,"sine",freq) for i,freq in enumerate([523,587,659,784,880,1046,1175,1318])]:
    cfg=config("sfx-synth",name,dur+200)
    op("sfx-synth",cfg,"add-voice","--name","body","--wave",wave,"--freq",freq,"--dur",dur,"--gain","-16")
    op("sfx-synth",cfg,"set-envelope","--voice","body","--env","pluck")
    if wave!="noise": op("sfx-synth",cfg,"set-pitch","--voice","body","--slide-to",end,"--over",dur)
    if name.startswith("chain") or name in ("cut","levelup"):
        op("sfx-synth",cfg,"add-voice","--name","overtone","--wave","sine","--freq",freq*2.004,"--dur",dur*.65,"--gain","-24")
        op("sfx-synth",cfg,"set-envelope","--voice","overtone","--env","pluck")
    op("sfx-synth",cfg,"render")
cfg=config("sfx-sample","shatter",650)
op("sfx-sample",cfg,"add-sample","--name","debris_glass","--t",0,"--gain","-18","--fade-out",100)
op("sfx-sample",cfg,"add-sample","--name","snap_transient","--t",0,"--gain","-26")
op("sfx-sample",cfg,"render")

for name,tempo in [("title",100),("play",76)]:
    cfg=config("music",name,round(32*60000/tempo))
    op("music",cfg,"set-tempo","--bpm",tempo)
    for track,instrument,gain,pan in [("hook","music_box",-19,-.2),("harmony","vibraphone",-23,.25),("bass","marimba",-23,0)]:
        op("music",cfg,"define-track","--name",track,"--instrument",instrument)
        op("music",cfg,"set-track-fx","--track",track,"--gain",gain,"--pan",pan,"--reverb",.22)
    chords=[[50,57,62,65],[46,53,58,62],[53,60,65,69],[48,55,60,64]]
    hook=[74,77,81,77,76,74,69,72,74,77,81,84,81,77,76,72]
    for bar in range(8):
        chord=chords[bar%4]
        op("music",cfg,"add-note","--track","bass","--pitch",chord[0]-12,"--t",bar*4,"--dur",3.6,"--velocity",65)
        for beat,pitch in enumerate(chord):
            op("music",cfg,"add-note","--track","harmony","--pitch",pitch,"--t",bar*4+beat,"--dur",1.8,"--velocity",56)
        for beat in range(4 if name=="title" else 2):
            pitch=hook[(bar*2+beat)%len(hook)]
            op("music",cfg,"add-note","--track","hook","--pitch",pitch,"--t",bar*4+beat*(1 if name=="title" else 2)+.5,"--dur",.7,"--velocity",70 if beat==0 else 52)
    op("music",cfg,"render")

for name,count,speed,size,color in [("clear",13,58,2.3,"#b4eee1"),("flawed",28,105,3.7,"#ffcb7b"),("cut",22,75,3,"#fff3bd"),("aura",0,9,1.5,"#f5de9b")]:
    cfg=TMP/f"fx-{name}.json"
    write(cfg,dict(width=128,height=128,duration_ms=1200,fps=30,seed=77,
                   actions=str(TMP/f"fx-{name}-ops.json"),preview=str(TMP/f"fx-{name}.gif"),system=str(OUT/f"fx/{name}.json")))
    op("particle-2d",cfg,"init")
    args=["add-emitter","--name","splinters","--shape","disc","--radius",22 if name=="aura" else 5,"--x",0,"--y",0,"--lifetime",850 if name=="aura" else 460,"--lifetime-spread",100,"--speed",speed,"--speed-spread",speed*.35,"--cone-angle",180]
    args += ["--rate",9] if name=="aura" else ["--burst",count]
    op("particle-2d",cfg,*args)
    op("particle-2d",cfg,"set-particle","--emitter","splinters","--size-from",size,"--size-to",0,"--size-curve","ease-out","--opacity-from",.85,"--opacity-to",0,"--opacity-curve","linear","--color-gradient",f"#ffffff@0,{color}@0.3,#876b58@1","--rotation",80)
    op("particle-2d",cfg,"set-forces","--drag",1.8,"--gravity",12)
    if name=="aura": op("particle-2d",cfg,"set-timeline","--loop","true")
    op("particle-2d",cfg,"render","--frame",8,"--out",TMP/f"fx-{name}.png")
print("Facet: original pixel art, animations, four particle systems and audio produced.")

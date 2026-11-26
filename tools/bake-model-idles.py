"""Bake the pinned Bedrock idle clips to local numeric tracks (no runtime expression evaluator)."""
import ast
import json
import math
import operator
from pathlib import Path

OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
FUN = {"sin": lambda x: math.sin(math.radians(x)), "cos": lambda x: math.cos(math.radians(x)),
       "clamp": lambda x, lo, hi: min(hi, max(x, lo)), "abs": abs, "max": max, "min": min}
def number(node, t):
    if isinstance(node, ast.Constant): return float(node.value)
    if isinstance(node, ast.Name) and node.id == "time": return t
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub): return -number(node.operand,t)
    if isinstance(node, ast.BinOp): return OPS[type(node.op)](number(node.left,t),number(node.right,t))
    if isinstance(node, ast.Call): return FUN[node.func.id](*(number(x,t) for x in node.args))
    raise ValueError(ast.dump(node))

def sample(value, t):
    if isinstance(value, dict):
        keys=sorted((float(k),v) for k,v in value.items())
        left=max((x for x in keys if x[0]<=t),default=keys[0])
        right=min((x for x in keys if x[0]>t),default=keys[-1])
        def vector(v,edge): return v.get(edge,v.get('vector',v.get('post',v.get('pre')))) if isinstance(v,dict) else v
        a=sample(vector(left[1],'post'),t); b=sample(vector(right[1],'pre'),t)
        f=max(0,min(1,(t-left[0])/(right[0]-left[0]))) if right[0]>left[0] else 0
        return [x+(y-x)*f for x,y in zip(a,b)]
    if not isinstance(value,list): value=[value]*3
    def scalar(x):
        if isinstance(x,(int,float)): return x
        expr=x.lower().replace('query.anim_time','time').replace('q.anim_time','time').replace('math.','').strip().rstrip('*')
        return number(ast.parse(expr,mode='eval').body,t)
    return [round(scalar(x),3) for x in value]

for directory in Path('public/models').glob('*/'):
    animations=json.loads((directory/'animations.json').read_text())['animations']
    order=['air_idle'] if directory.name=='zubat' else ['battle_idle','ground_idle','air_idle']
    clip=next(k for suffix in order for k in animations if k.endswith('.'+suffix))
    source=animations[clip]
    duration=8 if directory.name in ['magnemite','gastly'] else (2 if directory.name=="pikachu" else 4)
    fps=12
    tracks=[]
    for bone,channels in source['bones'].items():
        for prop,v in channels.items():
            if prop not in ('position','rotation','scale'): continue
            frames=[sample(v,i/fps) for i in range(duration*fps+1)]
            tracks.append([bone,prop,frames if any(x!=frames[0] for x in frames) else frames[:1]])
    (directory/'idle.json').write_text(json.dumps(dict(clip=clip,fps=fps,duration=duration,tracks=tracks),separators=(',',':')))

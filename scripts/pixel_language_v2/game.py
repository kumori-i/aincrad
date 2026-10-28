"""Evaluator-owned latent factors. Policy inputs are RGB only."""
from dataclasses import dataclass
from itertools import combinations
import numpy as np

SIZE = 16
HUES = np.array([[.95,.20,.20],[.20,.90,.25],[.22,.30,.98],[.95,.85,.18]], dtype=np.float32)
ALL_RECTANGLES = tuple(tuple(h*4+s for h in hs for s in ss)
                       for hs in combinations(range(4),2) for ss in combinations(range(4),2))
TRAIN_RECTANGLES = tuple(r for r in ALL_RECTANGLES if all(t//4 != t%4 for t in r))
NOVEL_RECTANGLES = tuple(r for r in ALL_RECTANGLES if r not in TRAIN_RECTANGLES)
SPLIT_SPEC = {'version':2, 'train_rectangles':TRAIN_RECTANGLES,
              'novel_rectangles':NOVEL_RECTANGLES, 'image_size':SIZE,
              'train_translation':2.25, 'final_translation':2.75,
              'radius':[4.,4.75], 'brightness':[.8,1.],
              'background_rgb':[.01,.35], 'band_amplitude':.06,
              'train_family':'noise with optional horizontal/vertical bands',
              'novel_family':'noise plus checkerboard', 'novel_background_rgb':[.15,.40]}


def render(types, rng, novel=False):
    types = np.asarray(types).reshape(-1)
    n = len(types)
    spread = 2.75 if novel else 2.25
    dx, dy = rng.uniform(-spread,spread,(2,n,1,1))
    radius = rng.uniform(4.,4.75,(n,1,1))
    yy,xx = np.mgrid[:SIZE,:SIZE].astype(np.float32)
    x,y = (xx-7.5-dx)/radius,(yy-7.5-dy)/radius
    shape = (types%4)[:,None,None]
    masks = ((shape==0)&(x*x+y*y<=1)) | ((shape==1)&(np.maximum(abs(x),abs(y))<=.9))
    masks |= ((shape==2)&(y>=-1)&(y<=1)&(abs(x)<=(y+1)/2))
    masks |= ((shape==3)&(abs(x)+abs(y)<=1))
    lo,hi = (.15,.40) if novel else (.01,.35)
    pixels = rng.uniform(lo,hi,(n,3,SIZE,SIZE)).astype(np.float32)
    phase = rng.integers(0,4,(n,1,1,1))
    if novel:
        pattern = ((np.floor((xx[None,None]+phase)/2)+np.floor((yy[None,None]+phase)/2))%2)==0
    else:
        family = rng.integers(0,3,(n,1,1,1))
        pattern = ((family==1)&(((xx[None,None]+phase)%4)<2)) | ((family==2)&(((yy[None,None]+phase)%4)<2))
    pixels += pattern*.06
    colors = HUES[types//4]*rng.uniform(.8,1.,(n,1))
    return np.where(masks[:,None],colors[:,:,None,None],pixels).astype(np.float32),masks


@dataclass
class EpisodeBatch:
    sender: np.ndarray
    candidates: np.ndarray
    target: np.ndarray
    types: np.ndarray
    sender_masks: np.ndarray
    candidate_masks: np.ndarray


class Game:
    def __init__(self, seed, split):
        if split not in ('train','validation','iid','combination','nuisance','combined'):
            raise ValueError('Unknown split')
        self.split = split
        self.rectangles = NOVEL_RECTANGLES if split in ('combination','combined') else TRAIN_RECTANGLES
        self.novel = split in ('nuisance','combined')
        self.selection,self.sender_rng,self.receiver_rng = [np.random.default_rng(s) for s in np.random.SeedSequence(seed).spawn(3)]

    def batch(self,n):
        if not 1 <= n <= 8192:
            raise ValueError('Batch outside bounded range')
        rectangles = np.asarray(self.rectangles)
        types = rectangles[self.selection.integers(len(rectangles),size=n)]
        types = np.take_along_axis(types,self.selection.random((n,4)).argsort(1),axis=1)
        target = self.selection.integers(4,size=n)
        receiver,rm = render(types.ravel(),self.receiver_rng,self.novel)
        sender,sm = render(types[np.arange(n),target],self.sender_rng,self.novel)
        return EpisodeBatch(sender,receiver.reshape(n,4,3,SIZE,SIZE),target,types,sm,rm.reshape(n,4,SIZE,SIZE))

    def state(self):
        return {k:getattr(self,k).bit_generator.state for k in ('selection','sender_rng','receiver_rng')}

    def restore(self,state):
        if set(state) != {'selection','sender_rng','receiver_rng'}:
            raise ValueError('Invalid RNG streams')
        for key,value in state.items():
            getattr(self,key).bit_generator.state=value

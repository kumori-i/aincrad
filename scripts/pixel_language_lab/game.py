"""Environment truth is confined here; policies receive only RGB tensors."""
from dataclasses import dataclass
import numpy as np

SIZE = 16
HUES = np.array([[.95, .20, .20], [.20, .90, .25], [.22, .30, .98], [.95, .85, .18]], dtype=np.float32)
TRAIN_TYPES = tuple(i for i in range(16) if i // 4 != i % 4)
HELDOUT_TYPES = tuple(i for i in range(16) if i // 4 == i % 4)
SPLITS = {
    'train': (TRAIN_TYPES, False), 'validation': (TRAIN_TYPES, False),
    'iid': (TRAIN_TYPES, False), 'combination': (HELDOUT_TYPES, False),
    'nuisance': (TRAIN_TYPES, True), 'combined': (HELDOUT_TYPES, True),
}
SPLIT_SPEC = {
    'version': 1, 'train_types': TRAIN_TYPES, 'heldout_types': HELDOUT_TYPES,
    'image_size': SIZE, 'train_background': [0.01, 0.12],
    'heldout_background': [0.18, 0.30], 'train_translation': [-1, 1],
    'heldout_translation': [-2.5, 2.5], 'radius': [4.0, 5.0],
    'brightness': [0.85, 1.0], 'segmentation': 'supplied silhouette mask; RGB crop only to policy',
}


def render(types, rng, heldout_nuisance=False):
    """Draw independent perfectly segmented object crops; return RGB and masks.

    Four masks represent circle, square, upward triangle, diamond. They remain
    visibly different at the supported sizes. RGB backgrounds/lighting/position
    are independent of identity and of other views. Coordinates stay in renderer.
    """
    types = np.asarray(types).reshape(-1)
    n = len(types)
    spread = 2.5 if heldout_nuisance else 1.0
    dx, dy = rng.uniform(-spread, spread, (2, n, 1, 1))
    radius = rng.uniform(4.0, 5.0, (n, 1, 1))
    yy, xx = np.mgrid[:SIZE, :SIZE].astype(np.float32)
    x, y = (xx - 7.5 - dx) / radius, (yy - 7.5 - dy) / radius
    shape = (types % 4)[:, None, None]
    masks = ((shape == 0) & (x*x + y*y <= 1)) | ((shape == 1) & (np.maximum(abs(x), abs(y)) <= .9))
    masks |= ((shape == 2) & (y >= -1) & (y <= 1) & (abs(x) <= (y+1)/2))
    masks |= ((shape == 3) & (abs(x)+abs(y) <= 1.0))
    lo, hi = (.18, .30) if heldout_nuisance else (.01, .12)
    pixels = rng.uniform(lo, hi, (n, 3, SIZE, SIZE)).astype(np.float32)
    if heldout_nuisance:
        phase = rng.integers(0, 4, (n, 1, 1, 1))
        pixels += (((xx[None, None] + phase) % 4) < 2) * .06
    colors = HUES[types // 4] * rng.uniform(.85, 1, (n, 1))
    pixels = np.where(masks[:, None], colors[:, :, None, None], pixels).astype(np.float32)
    return pixels, masks


@dataclass
class EpisodeBatch:
    sender: np.ndarray
    candidates: np.ndarray
    target: np.ndarray
    types: np.ndarray  # evaluator-only diagnostics; never passed to a policy
    sender_masks: np.ndarray
    candidate_masks: np.ndarray


class Game:
    def __init__(self, seed, split, candidates=4):
        if split not in SPLITS or candidates not in (2, 3, 4):
            raise ValueError('Unknown split or candidate count (must be 2–4)')
        self.split, self.k = split, candidates
        self.pool, self.nuisance = SPLITS[split]
        # Distinct random streams for selection and the two independent views.
        streams = np.random.SeedSequence(seed).spawn(3)
        self.selection, self.sender_rng, self.receiver_rng = [np.random.default_rng(s) for s in streams]

    def batch(self, n):
        pool = np.asarray(self.pool)
        types = pool[self.selection.random((n, len(pool))).argsort(axis=1)[:, :self.k]]
        target = self.selection.integers(self.k, size=n)
        receiver, rm = render(types.ravel(), self.receiver_rng, self.nuisance)
        sender, sm = render(types[np.arange(n), target], self.sender_rng, self.nuisance)
        return EpisodeBatch(sender, receiver.reshape(n, self.k, 3, SIZE, SIZE), target,
                            types, sm, rm.reshape(n, self.k, SIZE, SIZE))

    def state(self):
        return {key: getattr(self, key).bit_generator.state for key in ('selection', 'sender_rng', 'receiver_rng')}

    def restore(self, state):
        for key, value in state.items():
            getattr(self, key).bit_generator.state = value

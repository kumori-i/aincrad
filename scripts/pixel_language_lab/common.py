"""Bounded artifact helpers, reproducible fingerprints, trusted-local checkpoints."""
import hashlib
import json
from pathlib import Path
import platform
import torch
import numpy as np
from .game import SPLIT_SPEC

DEFAULT = {'version': 1, 'steps': 7500, 'batch_size': 128, 'lr': .001,
           'entropy_start': .02, 'entropy_end': .002, 'baseline_decay': .95,
           'threads': 2, 'alphabet': 8, 'message_length': 2, 'max_seconds': 600}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_digest():
    root = Path(__file__).parent
    files = {p.name: file_digest(p) for p in sorted(root.glob('*.py'))}
    files['config-v1.json'] = file_digest(root / 'config-v1.json')
    files['PROTOCOL.md'] = file_digest(root.parents[1] / 'docs/pixel-language/PROTOCOL.md')
    return digest(files)


def environment():
    return {'python': platform.python_version(), 'torch': str(torch.__version__),
            'numpy': np.__version__, 'platform': platform.platform(), 'cuda_used': False}


def write_json(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
    temp.replace(path)


def init(seed, threads=2):
    if threads not in (1, 2):
        raise ValueError('Bounded lab supports one or two CPU threads')
    torch.set_num_threads(threads)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)


def fingerprint(model):
    sha = hashlib.sha256()
    for name, value in sorted(model.state_dict().items()):
        sha.update(name.encode()); sha.update(value.detach().numpy().tobytes())
    return sha.hexdigest()


def provenance(config):
    return {'config': config, 'config_sha256': digest(config), 'split': SPLIT_SPEC,
            'split_sha256': digest(SPLIT_SPEC), 'source_sha256': source_digest(),
            'environment': environment()}

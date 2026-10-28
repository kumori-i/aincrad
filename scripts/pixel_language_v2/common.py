"""Versioned local artifact provenance and deterministic CPU setup."""
import hashlib
import json
from pathlib import Path
import platform
import torch
import numpy as np
from .game import SPLIT_SPEC

ROOT = Path(__file__).parent
CONFIG = json.loads((ROOT/'config.json').read_text())
PROTOCOL = ROOT.parents[1]/'docs/pixel-language-v2/PROTOCOL.md'

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'))

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def source_files():
    return {**{p.name:p for p in ROOT.glob('*.py')},'config.json':ROOT/'config.json','PROTOCOL.md':PROTOCOL}

def source_digest():
    return digest({k:file_digest(p) for k,p in source_files().items()})

def write_json(path,value):
    path=Path(path); temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n'); temp.replace(path)

def init(seed):
    torch.set_num_threads(CONFIG['threads']); torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)

def fingerprint(model):
    sha=hashlib.sha256()
    for name,value in sorted(model.state_dict().items()):
        sha.update(name.encode()); sha.update(value.detach().numpy().tobytes())
    return sha.hexdigest()

def effective_config(seed,control,coefficient,pilot=False):
    if coefficient not in CONFIG['pilot_coefficients']:
        raise ValueError('Coefficient outside predeclared pilot set')
    if seed not in (CONFIG['pilot_seed'],*CONFIG['main_seeds']):
        raise ValueError('Seed outside predeclared set')
    if pilot != (seed==CONFIG['pilot_seed']) or (pilot and control):
        raise ValueError('Invalid pilot/main role')
    return dict(CONFIG,seed=seed,control=bool(control),marginal_entropy=coefficient,
                pilot=pilot,steps=CONFIG['pilot_steps'] if pilot else CONFIG['steps'])

def provenance(config):
    return {'config':config,'config_sha256':digest(config),'split':SPLIT_SPEC,
            'split_sha256':digest(SPLIT_SPEC),'source_sha256':source_digest(),
            'environment':{'python':platform.python_version(),'torch':str(torch.__version__),
                           'numpy':np.__version__,'platform':platform.platform(),'cuda_used':False}}

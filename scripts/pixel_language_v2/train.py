"""Finite sampled-reward CPU attempts. No final evaluation imports or streams."""
import argparse
import json
import math
from pathlib import Path
import shutil
import resource
import sys
import time
import torch
from .common import CONFIG,init,provenance,write_json,file_digest,source_files,effective_config,digest,source_digest
from .game import Game
from .models import Sender,Receiver,reinforce


def make_models(seed,control):
    init(seed*10+1)
    receiver=Receiver()
    init(seed*10+2)
    sender=None if control else Sender()
    init(seed*10+3)
    return sender,receiver


def selected_coefficient(path):
    selection=json.loads(Path(path).read_text())
    if selection['source_sha256']!=source_digest() or selection['config_sha256']!=digest(CONFIG):
        raise ValueError('Selection source/config differs')
    coefficient=selection['selected_coefficient']
    if coefficient not in CONFIG['pilot_coefficients']:
        raise ValueError('Invalid selected coefficient')
    pilots=selection.get('pilots',[])
    if sorted(p.get('coefficient',-1) for p in pilots)!=CONFIG['pilot_coefficients']:
        raise ValueError('Selection must retain both pilot variants')
    if any(not isinstance(p.get('score'),(float,int)) or not math.isfinite(p['score']) for p in pilots):
        raise ValueError('Invalid selection scores')
    expected=sorted(pilots,key=lambda p:(-p['score'],p['coefficient']))[0]['coefficient']
    if coefficient!=expected:
        raise ValueError('Selected coefficient violates fixed rule')
    return coefficient


def train(output,seed,coefficient,control=False,pilot=False,selection_path=None):
    config=effective_config(seed,control,coefficient,pilot)
    if not pilot:
        if selection_path is None or selected_coefficient(selection_path)!=coefficient:
            raise ValueError('Main requires frozen validation selection')
    output=Path(output); output.mkdir(parents=True,exist_ok=False)
    source=output/'source'; source.mkdir()
    for name,path in source_files().items():
        shutil.copy2(path,source/name)
    sender,receiver=make_models(seed,control)
    parameters=list(receiver.parameters())+([] if sender is None else list(sender.parameters()))
    optimizer=torch.optim.Adam(parameters,lr=config['lr'])
    game=Game([config['training_namespace'],seed],'train')
    baseline=.25
    record=dict(provenance(config),seed=seed,control=control,pilot=pilot,status='running',completed_steps=0,
                selection_sha256=None if pilot else file_digest(selection_path),
                parameters=sum(p.numel() for p in parameters))
    write_json(output/'attempt.json',record)
    start=time.monotonic(); completed=0; rewards=[]
    try:
        with (output/'training.jsonl').open('x') as log:
            for step in range(1,config['steps']+1):
                if time.monotonic()-start>=config['max_seconds']:
                    record['status']='timeout'; break
                f=(step-1)/max(1,config['steps']-1)
                entropy=config['entropy_start']*(1-f)+config['entropy_end']*f
                loss,reward,stats=reinforce(sender,receiver,game.batch(config['batch_size']),baseline,entropy,coefficient)
                if not torch.isfinite(loss):
                    raise FloatingPointError('Non-finite policy loss')
                optimizer.zero_grad(set_to_none=True); loss.backward()
                gradient=torch.nn.utils.clip_grad_norm_(parameters,5)
                if not torch.isfinite(gradient):
                    raise FloatingPointError('Non-finite gradient')
                optimizer.step()
                baseline=config['baseline_decay']*baseline+(1-config['baseline_decay'])*reward
                completed=step; rewards.append(reward)
                if step%100==0 or step==config['steps']:
                    event=dict(stats,step=step,reward_last100=sum(rewards[-100:])/len(rewards[-100:]),
                               baseline=baseline,loss=loss.item(),gradient_norm=float(gradient),seconds=time.monotonic()-start)
                    log.write(json.dumps(event)+'\n'); log.flush(); print(json.dumps(event),flush=True)
            else:
                record['status']='completed'
    except BaseException as exc:
        record['status']='failed'; record['error']=repr(exc)
        raise
    finally:
        record.update(completed_steps=completed,elapsed_seconds=time.monotonic()-start,
                      peak_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024))
        torch.save(dict(record,sender=None if sender is None else sender.state_dict(),receiver=receiver.state_dict(),
                        optimizer=optimizer.state_dict(),baseline=baseline,torch_rng=torch.get_rng_state(),game_rng=game.state()),output/'checkpoint.pt')
        record['checkpoint_sha256']=file_digest(output/'checkpoint.pt'); write_json(output/'attempt.json',record)
    return record


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',required=True);p.add_argument('--seed',type=int,required=True)
    p.add_argument('--coefficient',type=float);p.add_argument('--pilot',action='store_true');p.add_argument('--control',action='store_true');p.add_argument('--selection')
    args=p.parse_args()
    coefficient=args.coefficient if args.pilot else selected_coefficient(args.selection)
    train(args.output,args.seed,coefficient,args.control,args.pilot,args.selection)

if __name__=='__main__':
    main()

"""Frozen v2 evaluation and validation-only selection, with mandatory cohort seals."""
import argparse
import json
import math
from pathlib import Path
import numpy as np
import torch
from .common import CONFIG,init,file_digest,fingerprint,write_json,digest,source_digest,effective_config
from .game import Game,SPLIT_SPEC
from .models import Sender,Receiver
from .train import selected_coefficient

FINAL_SPLITS=('iid','combination','nuisance','combined')
EVAL_SPEC={'version':2,'seed':CONFIG['evaluation_seed'],'namespace':CONFIG['final_namespace'],
           'episodes':CONFIG['evaluation_episodes'],'splits':FINAL_SPLITS,'candidates':4,
           'bootstrap_samples':CONFIG['bootstrap_samples'],'inference':'argmax',
           'primary':'iid normal-minus-shuffled; independent both-feature ceiling 50%'}

def wilson(correct, n):
    z = 1.959963984540054
    p = correct/n
    center = (p + z*z/(2*n))/(1+z*z/n)
    half = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n))/(1+z*z/n)
    return [center-half, center+half]


def derangement(n, rng):
    # A uniformly sampled permutation conditioned on no fixed points. This
    # preserves the exact message marginal without predictable cyclic pairing.
    if n < 2:
        raise ValueError('Derangement needs at least two episodes')
    while True:
        order = rng.permutation(n)
        if np.all(order != np.arange(n)):
            return order


def paired_interval(normal_correct, all_correct, message_ids, rng, samples=1000):
    """Resample episodes and re-pair their messages on every bootstrap replicate.

    Conditional on the trained policy and empirical episode distribution; not
    across-training-seed uncertainty. Candidate pixels are fixed within a row.
    """
    n = len(message_ids)
    deltas = np.empty(samples)
    for i in range(samples):
        rows = rng.integers(n, size=n)
        permutation = derangement(n, rng)
        altered = all_correct[rows, message_ids[rows[permutation]]]
        deltas[i] = normal_correct[rows].mean() - altered.mean()
    return np.quantile(deltas, [.025, .975]).tolist()


def load_checkpoint(path):
    data=torch.load(path,map_location='cpu',weights_only=True)
    expected=effective_config(data['seed'],data['control'],data['config']['marginal_entropy'],data['pilot'])
    if data['config']!=expected or data['config_sha256']!=digest(expected):
        raise ValueError('Checkpoint effective config mismatch')
    if data['source_sha256']!=source_digest() or data['split_sha256']!=digest(SPLIT_SPEC):
        raise ValueError('Checkpoint source/protocol/split mismatch')
    if data['status'] not in ('completed','timeout','failed'):
        raise ValueError('Checkpoint must be terminal')
    if not 0<=data['completed_steps']<=expected['steps'] or (data['status']=='completed' and data['completed_steps']!=expected['steps']):
        raise ValueError('Invalid completed horizon')
    init(data['seed'])
    sender=None if data['control'] else Sender();receiver=Receiver()
    receiver.load_state_dict(data['receiver']);receiver.eval()
    if sender is not None:
        sender.load_state_dict(data['sender']);sender.eval()
    return data,sender,receiver


@torch.inference_mode()
def measure(sender,receiver,split,episodes=2048,bootstrap_samples=1000):
    if not 2<=episodes<=8192 or not 1<=bootstrap_samples<=2000:
        raise ValueError('Evaluation size outside bounded range')
    split_id={'validation':0,**{s:i+1 for i,s in enumerate(FINAL_SPLITS)}}[split]
    namespace=CONFIG['validation_namespace'] if split=='validation' else CONFIG['final_namespace']
    game=Game([CONFIG['evaluation_seed'],namespace,split_id],split)
    intervention_rng=np.random.default_rng([CONFIG['evaluation_seed'],namespace,split_id,777])
    before=[fingerprint(receiver),None if sender is None else fingerprint(sender)]
    all_tokens=torch.tensor([(a,b) for a in range(8) for b in range(8)])
    queries=receiver.query(all_tokens)
    all_choices,normal_ids,zero_choices,targets,types=[],[],[],[],[]
    for start in range(0,episodes,128):
        batch=game.batch(min(128,episodes-start)); n=len(batch.target)
        encoded=receiver.encoder(torch.from_numpy(batch.candidates).flatten(0,1)).reshape(n,4,32)
        predictions=torch.einsum('nkd,md->nmk',encoded,queries).argmax(-1)
        all_choices.append(predictions.numpy())
        zero_choices.append((encoded*receiver.query(None,n)[:,None]).sum(-1).argmax(-1).numpy())
        tokens=np.zeros((n,2),dtype=np.int64) if sender is None else sender(torch.from_numpy(batch.sender)).logits.argmax(-1).numpy()
        normal_ids.append(tokens[:,0]*8+tokens[:,1]);targets.append(batch.target);types.append(batch.types)
    choices=np.concatenate(all_choices);ids=np.concatenate(normal_ids);target=np.concatenate(targets)
    types=np.concatenate(types);row=np.arange(episodes);target_types=types[row,target]
    shuffle=derangement(episodes,intervention_rng);random_ids=intervention_rng.integers(64,size=episodes)
    results={'normal':choices[row,ids],'shuffled':choices[row,ids[shuffle]],
             'random':choices[row,random_ids],'zero_embedding':np.concatenate(zero_choices)}
    if sender is None:
        results={'receiver_only':results['zero_embedding']}
    metrics={}
    for name,values in results.items():
        count=int((values==target).sum())
        metrics[name]={'correct':count,'episodes':episodes,'accuracy':count/episodes,'wilson95':wilson(count,episodes)}
    summary={'split':split,'candidates':4,'chance':.25,'single_factor_ceiling':.5,'metrics':metrics}
    if sender is not None:
        counts=np.bincount(ids,minlength=64)
        summary.update(message_counts=counts.tolist(),distinct_messages=int(np.count_nonzero(counts)))
        summary['normal_minus_shuffled']={'difference':metrics['normal']['accuracy']-metrics['shuffled']['accuracy'],
            'bootstrap95':paired_interval(results['normal']==target,choices==target[:,None],ids,intervention_rng,bootstrap_samples),
            'bootstrap_samples':bootstrap_samples}
        usage=np.zeros((16,64),dtype=np.int64);np.add.at(usage,(target_types,ids),1)
        summary['usage_by_evaluator_type']=usage.tolist()
    prediction=results['receiver_only' if sender is None else 'normal'];predicted_types=types[row,prediction]
    wrong=prediction!=target
    summary['error_counts']={'same_hue_wrong_shape':int((wrong&(predicted_types//4==target_types//4)).sum()),
        'same_shape_wrong_hue':int((wrong&(predicted_types%4==target_types%4)).sum()),
        'both_different':int((wrong&(predicted_types//4!=target_types//4)&(predicted_types%4!=target_types%4)).sum())}
    unseen=target_types//4==target_types%4
    summary['target_subsets']={}
    for name,mask in [('seen',~unseen),('unseen',unseen)]:
        n=int(mask.sum()); count=int(((prediction==target)&mask).sum())
        summary['target_subsets'][name]={'episodes':n,'correct':count,'accuracy':count/n if n else None,
            'wilson95':wilson(count,n) if n else None,'single_factor_ceiling':None}
    assert before==[fingerprint(receiver),None if sender is None else fingerprint(sender)],'Evaluation mutated weights'
    evidence={'target':target,'candidate_types':types,'message_id':ids,'shuffle_source_episode':shuffle,
              'random_message_id':random_ids,'all_message_choices':choices.astype(np.uint8),
              **{f'choice_{key}':value for key,value in results.items()}}
    return summary,evidence


def select(pilot_checkpoints,output):
    output=Path(output)
    if output.exists():
        raise FileExistsError('Refusing to overwrite selection')
    entries=[]
    for path in pilot_checkpoints:
        data,sender,receiver=load_checkpoint(path)
        if not data['pilot'] or data['control'] or data['status']!='completed':
            raise ValueError('Both complete pilot attempts required; no survivor selection')
        summary,evidence=measure(sender,receiver,'validation',CONFIG['validation_episodes'],CONFIG['bootstrap_samples'])
        score=summary['normal_minus_shuffled']['difference']
        if not math.isfinite(score):
            raise ValueError('Non-finite validation score')
        artifact=Path(path).parent/'validation'
        artifact.mkdir(exist_ok=False)
        np.savez_compressed(artifact/'episodes.npz',**evidence);write_json(artifact/'metrics.json',summary)
        entries.append({'coefficient':data['config']['marginal_entropy'],'score':score,
                        'checkpoint_sha256':file_digest(path),'validation':summary,
                        'evidence_sha256':file_digest(artifact/'episodes.npz')})
    if sorted(e['coefficient'] for e in entries)!=CONFIG['pilot_coefficients']:
        raise ValueError('Exactly both predeclared pilot variants required')
    chosen=sorted(entries,key=lambda e:(-e['score'],e['coefficient']))[0]['coefficient']
    result={'version':2,'source_sha256':source_digest(),'config_sha256':digest(CONFIG),
            'selected_coefficient':chosen,'pilots':entries}
    write_json(output,result);return result


def seal(checkpoints,output,selection_path):
    output=Path(output)
    if output.exists():
        raise FileExistsError('Refusing to overwrite seal')
    coefficient=selected_coefficient(selection_path);selection_hash=file_digest(selection_path);entries=[]
    for path in checkpoints:
        data,_,_=load_checkpoint(path)
        if data['pilot'] or data['config']['marginal_entropy']!=coefficient or data['selection_sha256']!=selection_hash:
            raise ValueError('Main checkpoint does not match frozen pilot selection')
        entries.append({'path':str(Path(path).resolve()),'sha256':file_digest(path),'seed':data['seed'],'control':data['control'],
                        'status':data['status'],'completed_steps':data['completed_steps'],'config_sha256':data['config_sha256']})
    if sorted((e['seed'],e['control']) for e in entries)!=[(s,c) for s in CONFIG['main_seeds'] for c in (False,True)]:
        raise ValueError('All ten independent attempts required, including incomplete ones')
    result={'checkpoints':entries,'complete':all(e['status']=='completed' for e in entries),
            'selection_sha256':selection_hash,'selected_coefficient':coefficient,
            'evaluation':EVAL_SPEC,'evaluation_sha256':digest(EVAL_SPEC),'source_sha256':source_digest()}
    write_json(output,result);return result


def evaluate(checkpoint,output,seal_path):
    checkpoint_hash=file_digest(checkpoint);sealed=json.loads(Path(seal_path).read_text())
    if digest(EVAL_SPEC)!=sealed['evaluation_sha256'] or source_digest()!=sealed['source_sha256']:
        raise ValueError('Source/evaluation changed after seal')
    if checkpoint_hash not in [e['sha256'] for e in sealed['checkpoints']]:
        raise ValueError('Checkpoint absent from seal')
    data,sender,receiver=load_checkpoint(checkpoint)
    if data['pilot'] or data['selection_sha256']!=sealed['selection_sha256']:
        raise ValueError('Invalid confirmatory checkpoint selection')
    output=Path(output);output.mkdir(parents=True,exist_ok=False);summaries=[]
    for split in FINAL_SPLITS:
        summary,evidence=measure(sender,receiver,split,CONFIG['evaluation_episodes'],CONFIG['bootstrap_samples'])
        summaries.append(summary);np.savez_compressed(output/f'{split}.npz',**evidence)
        print(json.dumps({'split':split,'metrics':summary['metrics']}),flush=True)
    assert checkpoint_hash==file_digest(checkpoint),'Checkpoint changed during evaluation'
    report={'seed':data['seed'],'control':data['control'],'training_status':data['status'],'completed_steps':data['completed_steps'],
            'cohort_complete':sealed['complete'],'checkpoint_sha256':checkpoint_hash,'config_sha256':data['config_sha256'],
            'split_sha256':data['split_sha256'],'source_sha256':data['source_sha256'],'evaluation':EVAL_SPEC,'results':summaries,
            'evidence_sha256':{p.name:file_digest(p) for p in output.glob('*.npz')}}
    write_json(output/'metrics.json',report);return report


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    s=sub.add_parser('select');s.add_argument('--output',required=True);s.add_argument('checkpoints',nargs='+')
    s=sub.add_parser('seal');s.add_argument('--output',required=True);s.add_argument('--selection',required=True);s.add_argument('checkpoints',nargs='+')
    s=sub.add_parser('run');s.add_argument('--output',required=True);s.add_argument('--seal',required=True);s.add_argument('--checkpoint',required=True)
    args=p.parse_args()
    if args.command=='select':select(args.checkpoints,args.output)
    elif args.command=='seal':seal(args.checkpoints,args.output,args.selection)
    else:evaluate(args.checkpoint,args.output,args.seal)

if __name__=='__main__':
    main()

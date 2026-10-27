"""Frozen inference only. Final evaluation requires a prewritten checkpoint seal."""
import argparse
import json
import math
from pathlib import Path
import numpy as np
import torch
from .common import init, file_digest, fingerprint, write_json, digest, source_digest, DEFAULT
from .game import Game, SPLIT_SPEC
from .models import Sender, Receiver

FINAL_SPLITS = ('iid', 'combination', 'nuisance', 'combined')
EVAL_SPEC = {'version': 1, 'seed': 20261027, 'episodes': 2048,
             'splits': FINAL_SPLITS, 'candidate_counts': [2, 3, 4],
             'bootstrap_samples': 1000, 'interval': 'percentile bootstrap; resample episodes and re-derange messages',
             'inference': 'argmax', 'primary': 'iid/4 normal-minus-shuffled'}


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


def load_checkpoint(path):
    # Only local, trusted checkpoints. weights_only excludes arbitrary globals.
    data = torch.load(path, map_location='cpu', weights_only=True)
    init(data['seed'])
    sender = None if data['control'] else Sender()
    receiver = Receiver()
    receiver.load_state_dict(data['receiver']); receiver.eval()
    if sender is not None:
        sender.load_state_dict(data['sender']); sender.eval()
    return data, sender, receiver


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


@torch.inference_mode()
def measure(sender, receiver, split, candidates, episodes=2048, bootstrap_samples=1000):
    if episodes < 2 or episodes > 8192:
        raise ValueError('Evaluation episode count outside bounded range')
    split_id = {'validation': 0, **{s: i+1 for i, s in enumerate(FINAL_SPLITS)}}[split]
    game = Game([EVAL_SPEC['seed'], split_id, candidates], split, candidates)
    intervention_rng = np.random.default_rng([EVAL_SPEC['seed'], split_id, candidates, 777])
    before = [fingerprint(receiver), None if sender is None else fingerprint(sender)]
    all_tokens = torch.tensor([(a, b) for a in range(8) for b in range(8)])
    queries = receiver.query(all_tokens)
    all_choices, normal_ids, zero_choices, targets, types = [], [], [], [], []
    for start in range(0, episodes, 128):
        batch = game.batch(min(128, episodes-start))
        pixels = torch.from_numpy(batch.candidates)
        n = len(batch.target)
        encoded = receiver.encoder(pixels.flatten(0, 1)).reshape(n, candidates, 32)
        predictions = torch.einsum('nkd,md->nmk', encoded, queries).argmax(-1)
        all_choices.append(predictions.numpy())
        zero_choices.append((encoded * receiver.query(None, n)[:, None]).sum(-1).argmax(-1).numpy())
        tokens = np.zeros((n, 2), dtype=np.int64) if sender is None else sender(torch.from_numpy(batch.sender)).logits.argmax(-1).numpy()
        normal_ids.append(tokens[:, 0]*8+tokens[:, 1])
        targets.append(batch.target); types.append(batch.types)
    choices = np.concatenate(all_choices)
    ids = np.concatenate(normal_ids)
    target = np.concatenate(targets)
    row = np.arange(episodes)
    shuffle = derangement(episodes, intervention_rng)
    random_ids = intervention_rng.integers(64, size=episodes)
    results = {'normal': choices[row, ids], 'shuffled': choices[row, ids[shuffle]],
               'random': choices[row, random_ids], 'zero_embedding': np.concatenate(zero_choices)}
    if sender is None:
        # A control has no sender; its normal task is exactly zero embeddings.
        results = {'receiver_only': results['zero_embedding']}
    metrics = {}
    for name, values in results.items():
        count = int((values == target).sum())
        metrics[name] = {'correct': count, 'episodes': episodes, 'accuracy': count/episodes,
                         'wilson95': wilson(count, episodes)}
    counts = np.bincount(ids, minlength=64)
    summary = {'split': split, 'candidates': candidates, 'chance': 1/candidates,
               'metrics': metrics, 'message_counts': counts.tolist() if sender is not None else None,
               'distinct_messages': int(np.count_nonzero(counts)) if sender is not None else 0}
    if sender is not None:
        normal_correct = results['normal'] == target
        all_correct = choices == target[:, None]
        summary['normal_minus_shuffled'] = {
            'difference': metrics['normal']['accuracy']-metrics['shuffled']['accuracy'],
            'bootstrap95': paired_interval(normal_correct, all_correct, ids, intervention_rng, bootstrap_samples),
            'bootstrap_samples': bootstrap_samples}
    assert before == [fingerprint(receiver), None if sender is None else fingerprint(sender)], 'Evaluation mutated weights'
    target_types = np.concatenate(types)[row, target]
    usage = np.zeros((16, 64), dtype=np.int64)
    np.add.at(usage, (target_types, ids), 1)
    summary['usage_by_evaluator_type'] = usage.tolist() if sender is not None else None
    evidence = {'target': target, 'candidate_types': np.concatenate(types), 'message_id': ids,
                'shuffle_source_episode': shuffle, 'random_message_id': random_ids,
                **{f'choice_{key}': value for key, value in results.items()}}
    return summary, evidence


def seal(checkpoints, output):
    output = Path(output)
    if output.exists():
        raise FileExistsError('Refusing to overwrite checkpoint seal')
    entries = []
    for path in checkpoints:
        data, _, _ = load_checkpoint(path)
        expected = dict(DEFAULT, seed=data['seed'], control=data['control'])
        if data['config'] != expected or data['config_sha256'] != digest(expected):
            raise ValueError('Checkpoint effective config differs from predeclared main protocol')
        if data['source_sha256'] != source_digest() or data['split_sha256'] != digest(SPLIT_SPEC):
            raise ValueError('Checkpoint source/protocol/split differs from frozen evaluation')
        if data['status'] not in ('completed', 'failed', 'timeout'):
            raise ValueError('Checkpoint attempt is not terminal')
        if not 0 <= data['completed_steps'] <= expected['steps']:
            raise ValueError('Invalid checkpoint completed step count')
        if data['status'] == 'completed' and data['completed_steps'] != expected['steps']:
            raise ValueError('Completed checkpoint has incomplete horizon')
        entries.append({'path': str(Path(path).resolve()), 'sha256': file_digest(path),
                        'seed': data['seed'], 'control': data['control'], 'status': data['status'],
                        'completed_steps': data['completed_steps'], 'config_sha256': data['config_sha256']})
    if sorted((e['seed'], e['control']) for e in entries) != [(s, c) for s in (17, 29, 43) for c in (False, True)]:
        raise ValueError('Final seal requires all six predeclared independent attempts, including failures/timeouts')
    write_json(output, {'checkpoints': entries, 'evaluation': EVAL_SPEC, 'evaluation_sha256': digest(EVAL_SPEC),
                        'source_sha256': source_digest()})


def evaluate(checkpoint, output, seal_path=None, validation=False):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    checkpoint_hash = file_digest(checkpoint)
    if not validation:
        if seal_path is None:
            raise ValueError('Final evaluation needs --seal')
        sealed = json.loads(Path(seal_path).read_text())
        if digest(EVAL_SPEC) != sealed['evaluation_sha256'] or source_digest() != sealed['source_sha256']:
            raise ValueError('Evaluation protocol/source changed after seal')
        if checkpoint_hash not in [entry['sha256'] for entry in sealed['checkpoints']]:
            raise ValueError('Checkpoint absent from seal')
    data, sender, receiver = load_checkpoint(checkpoint)
    summaries = []
    splits = ('validation',) if validation else FINAL_SPLITS
    for split in splits:
        for k in ((4,) if validation else (2, 3, 4)):
            summary, evidence = measure(sender, receiver, split, k, 512 if validation else EVAL_SPEC['episodes'],
                                        200 if validation else EVAL_SPEC['bootstrap_samples'])
            summaries.append(summary)
            np.savez_compressed(output / f'{split}-{k}.npz', **evidence)
            print(json.dumps({'split': split, 'candidates': k, 'metrics': summary['metrics']}), flush=True)
    assert checkpoint_hash == file_digest(checkpoint), 'Checkpoint changed during evaluation'
    report = {'seed': data['seed'], 'control': data['control'], 'training_status': data['status'],
              'completed_steps': data['completed_steps'], 'checkpoint_sha256': checkpoint_hash,
              'config_sha256': data['config_sha256'], 'split_sha256': data['split_sha256'],
              'evaluation': EVAL_SPEC, 'validation_only': validation, 'results': summaries,
              'evidence_sha256': {p.name: file_digest(p) for p in output.glob('*.npz')}}
    write_json(output / 'metrics.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    s = sub.add_parser('seal'); s.add_argument('--output', required=True); s.add_argument('checkpoints', nargs='+')
    e = sub.add_parser('run'); e.add_argument('--checkpoint', required=True); e.add_argument('--output', required=True)
    e.add_argument('--seal'); e.add_argument('--validation', action='store_true')
    args = parser.parse_args()
    if args.command == 'seal':
        seal(args.checkpoints, args.output)
    else:
        evaluate(args.checkpoint, args.output, args.seal, args.validation)


if __name__ == '__main__':
    main()

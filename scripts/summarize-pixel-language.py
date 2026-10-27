"""Reduce sealed lab evidence into compact, release-facing measurements.

Standard library only. Does not import policies, retrain, select models or modify
checkpoints. Usage: python scripts/summarize-pixel-language.py RUNS OUTPUT
"""
import hashlib
import json
from pathlib import Path
import sys


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


def summarize(root, output):
    root, output = Path(root), Path(output)
    sealed = load(root / 'seal.json')
    output.mkdir(parents=True, exist_ok=True)
    attempts, cells, usage = [], [], []
    for seed in (17, 29, 43):
        for role in ('main', 'control'):
            run = root / f'{role}-{seed}'
            record = load(run / 'attempt.json')
            metrics = load(run / 'evaluation/metrics.json')
            checkpoint_hash = sha(run / 'checkpoint.pt')
            if checkpoint_hash not in [entry['sha256'] for entry in sealed['checkpoints']]:
                raise ValueError('Attempt absent from frozen checkpoint manifest')
            if metrics['checkpoint_sha256'] != checkpoint_hash or metrics['validation_only']:
                raise ValueError('Metrics/checkpoint mismatch or not final evaluation')
            attempts.append({k: record[k] for k in ('seed', 'control', 'status', 'completed_steps',
                             'elapsed_seconds', 'parameters', 'checkpoint_sha256', 'config_sha256',
                             'source_sha256', 'split_sha256', 'environment')})
            for result in metrics['results']:
                cell = {k: v for k, v in result.items() if k not in ('usage_by_evaluator_type', 'message_counts')}
                cells.append(dict(seed=seed, control=role == 'control', **cell))
                if role == 'main' and result['split'] == 'iid' and result['candidates'] == 4:
                    counts = result['usage_by_evaluator_type']
                    usage.append({'seed': seed, 'message_counts': result['message_counts'],
                                  'top_messages_by_type': [
                                      {'evaluator_type': i, 'observations': sum(row),
                                       'top_messages': [{'tokens': [m//8, m%8], 'count': row[m]}
                                                        for m in sorted(range(64), key=lambda m: -row[m])[:3] if row[m]]}
                                      for i, row in enumerate(counts) if sum(row)]})
            for filename, expected in metrics['evidence_sha256'].items():
                if sha(run / 'evaluation' / filename) != expected:
                    raise ValueError('Evaluation evidence hash mismatch')
    pilot = load(root / 'pilot-101/attempt.json')
    pilot_metrics = load(root / 'pilot-101-validation/metrics.json')['results'][0]
    report = {'protocol': 'v1 with one pre-final horizon amendment', 'source_sha256': sealed['source_sha256'],
              'evaluation': sealed['evaluation'], 'evaluation_sha256': sealed['evaluation_sha256'],
              'attempts': attempts, 'pilot': {k: pilot[k] for k in ('seed', 'status', 'completed_steps',
                                                            'elapsed_seconds', 'checkpoint_sha256', 'source_sha256')},
              'pilot_validation': {k: v for k, v in pilot_metrics.items() if k not in ('usage_by_evaluator_type', 'message_counts')},
              'cells': cells, 'iid_four_candidate_usage': usage,
              'raw_metrics_sha256': {f'{role}-{seed}': sha(root / f'{role}-{seed}/evaluation/metrics.json')
                                     for seed in (17, 29, 43) for role in ('main', 'control')}}
    archive = root / 'aincrad-pixel-language-v1-evidence.zip'
    if archive.exists():
        report['evidence_archive'] = {'filename': archive.name, 'bytes': archive.stat().st_size, 'sha256': sha(archive)}
    (output / 'metrics.json').write_text(json.dumps(report, indent=2, sort_keys=True)+'\n')

    def cell(seed, split, control=False):
        return next(x for x in cells if x['seed'] == seed and x['split'] == split and x['control'] == control and x['candidates'] == 4)

    def pct(value):
        return f'{100*value:.1f}%'

    primary = [cell(seed, 'iid') for seed in (17, 29, 43)]
    passed = all(c['normal_minus_shuffled']['bootstrap95'][0] > 0 for c in primary)
    lines = ['# Pixel communication pilot: measured results', '',
             'This is an isolated synthetic experiment, not live-world language or vision.', '',
             '**Replicated message-use criterion: '+('met' if passed else 'not met')+'** under the predeclared rule: '
             'a positive lower paired-bootstrap bound for normal-minus-shuffled four-candidate IID accuracy in every independent seed.', '',
             '## All independent four-candidate results', '',
             'Each cell uses 2,048 frozen episodes; analytical chance is **25%**. Same episode sets and candidate order '
             'are used for normal/ablated inference and the separately trained receiver-only control. No model or seed was selected.', '',
             '| Split | Seed | Normal | Shuffled | Random | Zero embedding | Trained receiver only | Normal − shuffled (95% CI) |',
             '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |']
    for split in ('iid', 'combination', 'nuisance', 'combined'):
        for seed in (17, 29, 43):
            c, control = cell(seed, split), cell(seed, split, True)
            m, delta = c['metrics'], c['normal_minus_shuffled']
            low, high = delta['bootstrap95']
            values = [pct(m[key]['accuracy']) for key in ('normal', 'shuffled', 'random', 'zero_embedding')]
            values += [pct(control['metrics']['receiver_only']['accuracy']),
                       f"{100*delta['difference']:.1f} pp [{100*low:.1f}, {100*high:.1f}]"]
            lines.append(f'| {split} | {seed} | '+' | '.join(values)+' |')
    lines += ['', 'All 2/3/4-candidate results, Wilson intervals, exact counts, message diversity and source/checkpoint '
              'fingerprints are in [metrics.json](metrics.json). Chance is 50%, 33.3%, and 25%, respectively.', '',
              '## Attempts and compute', '',
              '| Attempt | Status | Steps | Training seconds |', '| --- | --- | ---: | ---: |',
              f"| pilot-101 | {pilot['status']} | {pilot['completed_steps']} | {pilot['elapsed_seconds']:.2f} |"]
    for a in attempts:
        lines.append(f"| {'control' if a['control'] else 'main'}-{a['seed']} | {a['status']} | {a['completed_steps']} | {a['elapsed_seconds']:.2f} |")
    lines += ['', f"Total recorded training time: {sum(a['elapsed_seconds'] for a in attempts)+pilot['elapsed_seconds']:.1f} seconds, "
              'on the cloud CPU host with two torch threads per run. This is not a laptop benchmark.', '',
              'The initial 400-step pilot collapsed to one argmax message: normal and shuffled validation were both '
              '146/512 (28.5%). It did not demonstrate communication. The single allowed validation-only amendment '
              'increased the fixed horizon to 7,500 steps for every main and control run. Final heldout metrics were '
              'opened only after all six checkpoints were frozen and sealed; there was no post-final tuning.', '',
              '## Interpretation limits', '',
              '- A positive ablation effect supports message-dependent matching in this task, not natural language, '
              'consciousness, English definitions or full-scene understanding.',
              '- The diagonal heldout pair set correlates hue and silhouette. Transfer there is **not** evidence of '
              'compositionality; a hue-only code can succeed. A perfect hue-only reference policy would score '
              '90.91% / 82.42% / 74.55% on this IID pool with 2 / 3 / 4 candidates, yet 100% on diagonal pairs '
              '(analytical structural benchmark, not an additional fitted model).',
              '- Random-token and zero-embedding interventions can be out-of-distribution. The marginal-preserving '
              'shuffled condition and independently trained receiver-only control are reported separately.',
              '- Confidence intervals are conditional on each fitted policy. The three seeds, not 2,048 episodes, '
              'are the independent training replications. All seed outcomes remain visible.',
              '- Perfect segmentation and a tiny renderer are supplied capabilities. Nothing was integrated into '
              'Aster, Mira, the live Ozark world, settings or saves.', '',
              '## Measured symbol usage', '']
    for u in usage:
        lines.append(f"- Seed {u['seed']}: {sum(v > 0 for v in u['message_counts'])} distinct argmax messages on four-candidate IID episodes.")
    lines += ['', 'The compact JSON records empirical top messages per evaluator type. Tokens are arbitrary integer '
              'symbols; evaluator hue/silhouette identifiers are never policy inputs or assigned dictionary meanings.', '',
              '## Provenance', '', f"Frozen source/protocol/config SHA-256: `{sealed['source_sha256']}`.", '',
              f"Evaluation specification SHA-256: `{sealed['evaluation_sha256']}`.", '',
              'Models, Adam states, reward baselines, RNG states, source snapshots and per-example evidence are retained '
              'in the bounded experiment archive; compact metrics reference their SHA-256 fingerprints. No checkpoint '
              'is loaded into the game. See [protocol](PROTOCOL.md) and [reproduction instructions](README.md).', '']
    if archive.exists():
        lines += [f"Evidence archive: `{archive.name}` ({archive.stat().st_size:,} bytes), SHA-256 `{sha(archive)}`.", '']
    (output / 'RESULTS.md').write_text('\n'.join(lines))
    return report


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python scripts/summarize-pixel-language.py RUNS OUTPUT')
    summarize(sys.argv[1], sys.argv[2])

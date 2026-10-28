"""Summarize a sealed v2 cohort without selecting seeds or hiding failed attempts."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.pixel_language_v2.common import CONFIG,file_digest,write_json


def summarize(root,output):
    root=Path(root);output=Path(output);output.mkdir(parents=True,exist_ok=True)
    selection=json.loads((root/'selection.json').read_text());seal=json.loads((root/'seal.json').read_text())
    attempts=[];reports=[]
    for name in ['pilot-002','pilot-010']+[f'{role}-{seed}' for seed in CONFIG['main_seeds'] for role in ('main','control')]:
        folder=root/name;attempt=json.loads((folder/'attempt.json').read_text())
        attempts.append({'name':name,**{k:attempt[k] for k in ('status','completed_steps','elapsed_seconds','checkpoint_sha256','peak_rss_bytes')}})
        if not name.startswith('pilot'):
            report=json.loads((folder/'evaluation/metrics.json').read_text())
            if report['checkpoint_sha256']!=attempt['checkpoint_sha256'] or report['source_sha256']!=seal['source_sha256']:
                raise ValueError('Summary cohort provenance mismatch')
            reports.append(report)
    main=[r for r in reports if not r['control']];controls={r['seed']:r for r in reports if r['control']}
    iid=[r['results'][0] for r in main]
    replicated=seal['complete'] and all(c['normal_minus_shuffled']['bootstrap95'][0]>0 for c in iid)
    both=replicated and all(c['metrics']['normal']['wilson95'][0]>.5 for c in iid)
    result={'version':2,'source_sha256':seal['source_sha256'],'cohort_complete':seal['complete'],
            'replicated_message_use':replicated,'replicated_both_features':both,
            'selection':selection,'attempts':attempts,'reports':reports,
            'seal_sha256':file_digest(root/'seal.json')}
    write_json(output/'metrics.json',result)
    observed_message=sum(c['normal_minus_shuffled']['bootstrap95'][0]>0 for c in iid)
    observed_both=sum(c['normal_minus_shuffled']['bootstrap95'][0]>0 and c['metrics']['normal']['wilson95'][0]>.5 for c in iid)
    lines=['# Pixel communication v2: measured results','',
           'Isolated synthetic RGB reference game; not live Ozark vision or language.','',
           f"Complete cohort: **{seal['complete']}**. Replicated message use: **{replicated}**. Replicated both-feature criterion: **{both}**.",'',
           f'At the observed checkpoints, {observed_message}/5 show a positive message-ablation effect and {observed_both}/5 exceed the single-feature ceiling. Partial checkpoints remain diagnostic, not completed replications.','',
           'All five seeds must meet the predeclared criterion. Failures and incomplete runs remain visible. Each cell uses 2,048 episodes and four candidates. Chance is 25%; the single-factor ceiling is 50% on these complete rectangle distributions.','',
           '| Split | Seed | Normal | Shuffled | Receiver-only | Normal − shuffled (95% interval) |',
           '| --- | ---: | ---: | ---: | ---: | --- |']
    for split in ('iid','combination','nuisance','combined'):
        for report in main:
            c=next(c for c in report['results'] if c['split']==split)
            control=next(c for c in controls[report['seed']]['results'] if c['split']==split)
            delta=c['normal_minus_shuffled'];ci=delta['bootstrap95'];m=c['metrics']
            lines.append(f"| {split} | {report['seed']} | {m['normal']['accuracy']:.1%} | {m['shuffled']['accuracy']:.1%} | {control['metrics']['receiver_only']['accuracy']:.1%} | {delta['difference']*100:.1f} pp [{ci[0]*100:.1f}, {ci[1]*100:.1f}] |")
    lines+=['','## Pilot selection','',
            f"Selected marginal-entropy coefficient: {selection['selected_coefficient']}. Both complete pilots used seed 107 and 3,000 steps. Selection used validation normal-minus-shuffled accuracy only; exact ties favored .02.",'',
            '| Coefficient | Normal | Shuffled | Distinct messages |','| ---: | ---: | ---: | ---: |']
    for pilot in selection['pilots']:
        v=pilot['validation'];lines.append(f"| {pilot['coefficient']} | {v['metrics']['normal']['accuracy']:.1%} | {v['metrics']['shuffled']['accuracy']:.1%} | {v['distinct_messages']} |")
    lines+=['','## All attempts','', '| Attempt | Status | Steps | Training seconds |','| --- | --- | ---: | ---: |']
    for a in attempts:lines.append(f"| {a['name']} | {a['status']} | {a['completed_steps']} | {a['elapsed_seconds']:.2f} |")
    lines+=['',f"Total training: {sum(a['elapsed_seconds'] for a in attempts):.1f} seconds on a cloud CPU, not a laptop benchmark.",'',
            '## Interpretation boundaries','',
            '- A timeout is a compute-budget interruption, not proof of learning collapse. Partial checkpoints are reported, but any incomplete attempt prevents a completed replication claim.',
            '- V1 and v2 tasks differ; their raw accuracy is not a matched improvement estimate.',
            '- The five training seeds are independent replications. Episode intervals are conditional on each fitted policy, not uncertainty across training seeds.',
            '- Complete rectangles test whether both visual features are needed. They do not prove factorized symbols, compositional grammar, or natural language.',
            '- Unseen-target subgroup accuracy changes the target prior. Its single-factor ceiling is not assumed to be 50%.',
            '- Random-token and zero-embedding frozen interventions may be out of distribution; separately trained receiver-only controls are distinct.',
            '- The entropy bonus is an engineered auxiliary bias. The source does not assign English words or semantic labels to policies.',
            '- All checkpoints were sealed before final evaluation; no post-final tuning or best-seed selection.',
            '', 'Full counts, Wilson intervals, random/zero controls, error categories, message usage, subgroup denominators and fingerprints are in [metrics.json](metrics.json).',
            '', f"Frozen source SHA-256: `{seal['source_sha256']}`.",'']
    lines += [f"Peak measured process RSS: {max(a['peak_rss_bytes'] for a in attempts)/1024**2:.1f} MiB.",'']
    receipt=root/'clean-export-receipt.json'
    if receipt.exists():
        archive=json.loads(receipt.read_text())
        lines += [f"Evidence archive: `{archive['filename']}` ({archive['bytes']:,} bytes), SHA-256 `{archive['sha256']}`.",'']
    (output/'RESULTS.md').write_text('\n'.join(lines))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();summarize(a.root,a.output)

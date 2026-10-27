"""Run a finite CPU-only attempt. Does not call any final evaluation split."""
import argparse
import json
from pathlib import Path
import time
import shutil
import torch
from .common import DEFAULT, init, provenance, write_json, file_digest
from .game import Game
from .models import Sender, Receiver, reinforce


def train(output, seed, control=False, steps=None, max_seconds=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)  # Never overwrite a prior attempt.
    config = dict(DEFAULT, seed=seed, control=control)
    if steps is not None:
        config['steps'] = steps
    if max_seconds is not None:
        config['max_seconds'] = max_seconds
    if not 1 <= config['steps'] <= 10000 or not 1 <= config['max_seconds'] <= 600:
        raise ValueError('Steps/time exceed bounded lab limits')
    source = output / 'source'
    source.mkdir()
    for path in Path(__file__).parent.glob('*.py'):
        shutil.copy2(path, source / path.name)
    shutil.copy2(Path(__file__).parent / 'config-v1.json', source / 'config-v1.json')
    shutil.copy2(Path(__file__).parents[2] / 'docs/pixel-language/PROTOCOL.md', source / 'PROTOCOL.md')
    init(seed, config['threads'])
    sender = None if control else Sender()
    receiver = Receiver()
    parameters = list(receiver.parameters()) + ([] if sender is None else list(sender.parameters()))
    optimizer = torch.optim.Adam(parameters, lr=config['lr'])
    game = Game([seed, 100], 'train')
    baseline = .25
    record = dict(provenance(config), status='running', seed=seed, control=control,
                  parameters=sum(p.numel() for p in parameters), completed_steps=0)
    write_json(output / 'attempt.json', record)
    start = time.monotonic()
    completed = 0
    rewards = []
    try:
        with (output / 'training.jsonl').open('x') as log:
            for step in range(1, config['steps'] + 1):
                if time.monotonic() - start >= config['max_seconds']:
                    record['status'] = 'timeout'
                    break
                fraction = (step - 1) / max(1, config['steps'] - 1)
                entropy = config['entropy_start'] * (1-fraction) + config['entropy_end'] * fraction
                loss, reward = reinforce(sender, receiver, game.batch(config['batch_size']), baseline, entropy)
                if not torch.isfinite(loss):
                    raise FloatingPointError('Non-finite policy loss')
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(parameters, 5)
                optimizer.step()
                baseline = config['baseline_decay']*baseline + (1-config['baseline_decay'])*reward
                completed = step
                rewards.append(reward)
                if step % 100 == 0 or step == config['steps']:
                    event = {'step': step, 'reward_last100': sum(rewards[-100:])/len(rewards[-100:]),
                             'baseline': baseline, 'loss': loss.item(), 'seconds': time.monotonic()-start}
                    log.write(json.dumps(event)+'\n'); log.flush()
                    print(json.dumps(event), flush=True)
            else:
                record['status'] = 'completed'
    except BaseException as exc:
        record['status'], record['error'] = 'failed', repr(exc)
        raise
    finally:
        record.update(completed_steps=completed, elapsed_seconds=time.monotonic()-start)
        checkpoint = dict(record, sender=None if sender is None else sender.state_dict(),
                          receiver=receiver.state_dict(), optimizer=optimizer.state_dict(),
                          baseline=baseline, torch_rng=torch.get_rng_state(), game_rng=game.state())
        torch.save(checkpoint, output / 'checkpoint.pt')
        record['checkpoint_sha256'] = file_digest(output / 'checkpoint.pt')
        write_json(output / 'attempt.json', record)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--seed', required=True, type=int)
    parser.add_argument('--control', action='store_true')
    parser.add_argument('--steps', type=int)
    parser.add_argument('--max-seconds', type=int)
    args = parser.parse_args()
    train(args.output, args.seed, args.control, args.steps, args.max_seconds)


if __name__ == '__main__':
    main()

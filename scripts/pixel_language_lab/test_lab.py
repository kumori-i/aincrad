"""Fast structural tests, not a research-success accuracy gate.

Run from the repository root:
    python -m unittest scripts.pixel_language_lab.test_lab -v
Only synthetic temporary artifacts are created; no game save/profile is opened.
"""
import copy
import inspect
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import torch

from .common import DEFAULT, digest, fingerprint, init
from .game import Game, HELDOUT_TYPES, HUES, SIZE, SPLITS, SPLIT_SPEC, TRAIN_TYPES, render
from .evaluate import EVAL_SPEC, derangement, load_checkpoint, measure, paired_interval, seal, wilson
from .models import Receiver, Sender, reinforce
from .train import train


class EndpointRng:
    """Deterministic renderer probe, not an episode/evaluation random stream."""
    def __init__(self, dx, dy, radius):
        self.dx, self.dy, self.radius = dx, dy, radius
        self.calls = 0

    def uniform(self, low, high, size):
        self.calls += 1
        if self.calls == 1:
            result = np.zeros(size)
            result[0] = self.dx
            result[1] = self.dy
            return result
        if self.calls == 2:
            return np.full(size, self.radius)
        return np.full(size, (low + high) / 2)

    def integers(self, low, high=None, size=None):
        return np.zeros(size, dtype=np.int64)


class RendererTests(unittest.TestCase):
    def test_split_contract(self):
        self.assertEqual(set(TRAIN_TYPES) | set(HELDOUT_TYPES), set(range(16)))
        self.assertFalse(set(TRAIN_TYPES) & set(HELDOUT_TYPES))
        self.assertEqual(tuple(i for i in range(16) if i // 4 == i % 4), HELDOUT_TYPES)
        self.assertEqual(SPLITS['train'][0], SPLITS['validation'][0])
        self.assertEqual(SPLITS['combination'][0], HELDOUT_TYPES)
        self.assertTrue(SPLITS['nuisance'][1])
        self.assertTrue(SPLITS['combined'][1])

    def test_shapes_ranges_segmentation_and_unique_candidates(self):
        for k in (2, 3, 4):
            batch = Game([991, k], 'train', candidates=k).batch(128)
            self.assertEqual(batch.sender.shape, (128, 3, SIZE, SIZE))
            self.assertEqual(batch.candidates.shape, (128, k, 3, SIZE, SIZE))
            self.assertEqual(batch.sender.dtype, np.float32)
            self.assertEqual(batch.sender_masks.dtype, np.bool_)
            self.assertEqual(batch.candidate_masks.shape, (128, k, SIZE, SIZE))
            self.assertTrue(np.all((batch.sender >= 0) & (batch.sender <= 1)))
            self.assertTrue(np.all((batch.candidates >= 0) & (batch.candidates <= 1)))
            for row in batch.types:
                self.assertEqual(len(set(row.tolist())), k)
                self.assertTrue(set(row).issubset(TRAIN_TYPES))
            target_views = batch.candidates[np.arange(128), batch.target]
            self.assertTrue(np.all(np.any(batch.sender != target_views, axis=(1, 2, 3))))
            # Perfect supplied masks are honest: each foreground is a single hue
            # multiplied by scalar illumination, not a hidden semantic overlay.
            for i in range(8):
                foreground = batch.sender[i, :, batch.sender_masks[i]].mean(axis=0)
                expected = HUES[batch.types[i, batch.target[i]] // 4]
                np.testing.assert_allclose(foreground / foreground.max(), expected / expected.max(), atol=2e-6)

    def test_target_selected_after_candidate_set_and_uniform(self):
        game = Game(122, 'train')
        order = []

        class Selection:
            def random(self, shape):
                order.append('candidate_set')
                return np.broadcast_to(np.arange(shape[1]), shape)

            def integers(self, high, size):
                order.append('target')
                return np.arange(size) % high

        game.selection = Selection()
        batch = game.batch(8)
        self.assertEqual(order, ['candidate_set', 'target'])
        np.testing.assert_array_equal(batch.target, np.arange(8) % 4)
        np.testing.assert_array_equal(batch.types, np.tile(np.array(TRAIN_TYPES[:4]), (8, 1)))
        for k in (2, 3, 4):
            positions = Game([321, k], 'train', candidates=k).batch(2048).target
            frequencies = np.bincount(positions, minlength=k) / len(positions)
            np.testing.assert_allclose(frequencies, np.full(k, 1/k), atol=.04)

    def test_restore_reproduces_all_independent_streams(self):
        game = Game(776, 'train')
        game.batch(3)
        state = game.state()
        first = game.batch(9)
        game.restore(state)
        second = game.batch(9)
        for name in vars(first):
            np.testing.assert_array_equal(getattr(first, name), getattr(second, name))
        # Advancing only sender rendering cannot alter candidates/target choices.
        other = Game(776, 'train')
        baseline = Game(776, 'train')
        other.sender_rng.random(100)
        altered, normal = other.batch(8), baseline.batch(8)
        np.testing.assert_array_equal(altered.candidates, normal.candidates)
        np.testing.assert_array_equal(altered.target, normal.target)
        self.assertFalse(np.array_equal(altered.sender, normal.sender))

    def test_silhouettes_remain_distinct_at_nuisance_endpoints(self):
        # Probe all supported translation/size extremes plus the center without
        # ever running a policy on final held-out episode streams.
        signatures = [set() for _ in range(4)]
        for nuisance, spread in ((False, 1), (True, 2.5)):
            for dx in (-spread, 0, spread):
                for dy in (-spread, 0, spread):
                    for radius in (4.0, 5.0):
                        pixels, masks = render(np.arange(4), EndpointRng(dx, dy, radius), nuisance)
                        self.assertEqual(len({m.tobytes() for m in masks}), 4)
                        self.assertTrue(np.all(masks.sum(axis=(1, 2)) > 10))
                        for shape, mask in enumerate(masks):
                            signatures[shape].add(mask.tobytes())
                        # No masked object touches both opposing edges, and no
                        # silhouette degenerates to a line under any endpoint.
                        for mask in masks:
                            self.assertGreater(np.count_nonzero(mask.any(axis=0)), 3)
                            self.assertGreater(np.count_nonzero(mask.any(axis=1)), 3)
                            self.assertFalse(mask[:, 0].any() and mask[:, -1].any())
                            self.assertFalse(mask[0].any() and mask[-1].any())
                        self.assertEqual(pixels.shape, (4, 3, SIZE, SIZE))
        for a in range(4):
            for b in range(a):
                self.assertFalse(signatures[a] & signatures[b], (a, b))

    def test_invalid_game_configuration_rejected(self):
        with self.assertRaises(ValueError):
            Game(1, 'unknown')
        for k in (0, 1, 5):
            with self.assertRaises(ValueError):
                Game(1, 'train', k)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        init(987, threads=1)

    def test_policy_api_has_no_truth_inputs_or_shared_parameters(self):
        self.assertEqual(list(inspect.signature(Sender.forward).parameters), ['self', 'pixels'])
        self.assertEqual(list(inspect.signature(Receiver.forward).parameters), ['self', 'candidates', 'tokens'])
        sender, receiver = Sender(), Receiver()
        sender_ids = {p.data_ptr() for p in sender.parameters()}
        receiver_ids = {p.data_ptr() for p in receiver.parameters()}
        self.assertFalse(sender_ids & receiver_ids)
        self.assertFalse(torch.equal(next(sender.encoder.parameters()), next(receiver.encoder.parameters())))
        batch = Game(4, 'train').batch(8)
        messages = sender(torch.from_numpy(batch.sender)).sample()
        self.assertEqual(tuple(messages.shape), (8, 2))
        self.assertTrue(torch.all((messages >= 0) & (messages < 8)).item())
        self.assertEqual(tuple(receiver(torch.from_numpy(batch.candidates), messages).probs.shape), (8, 4))

    def test_reward_alone_reaches_both_image_encoders(self):
        sender, receiver = Sender(), Receiver()
        batch = Game(182, 'train').batch(256)
        # Absence of type IDs/masks proves reinforcement does not require those
        # renderer diagnostics. Target is used only to produce scalar reward.
        policy_batch = SimpleNamespace(sender=batch.sender, candidates=batch.candidates, target=batch.target)
        loss, reward = reinforce(sender, receiver, policy_batch, baseline=.25, entropy=0)
        self.assertTrue(torch.isfinite(loss).item())
        self.assertGreater(reward, 0)
        loss.backward()
        for encoder in (sender.encoder, receiver.encoder):
            first = next(encoder.parameters())
            self.assertIsNotNone(first.grad)
            self.assertTrue(torch.isfinite(first.grad).all().item())
            self.assertGreater(first.grad.abs().sum().item(), 0)

    def test_receiver_only_control_has_trainable_visual_gradients(self):
        receiver = Receiver()
        loss, _ = reinforce(None, receiver, Game(35, 'train').batch(256), baseline=.25, entropy=0)
        loss.backward()
        self.assertGreater(next(receiver.encoder.parameters()).grad.abs().sum().item(), 0)
        self.assertIsNone(receiver.symbols.weight.grad)

    def test_candidate_permutation_equivariance(self):
        receiver = Receiver().eval()
        batch = Game(97, 'train').batch(8)
        images = torch.from_numpy(batch.candidates)
        messages = torch.tensor([[i % 8, (i+3) % 8] for i in range(8)])
        permutation = torch.tensor([2, 0, 3, 1])
        with torch.inference_mode():
            original = receiver(images, messages).probs
            permuted = receiver(images[:, permutation], messages).probs
            control = receiver(images).probs
            control_permuted = receiver(images[:, permutation]).probs
        torch.testing.assert_close(permuted, original[:, permutation])
        torch.testing.assert_close(control_permuted, control[:, permutation])

    def test_inference_does_not_change_policy_state(self):
        sender, receiver = Sender().eval(), Receiver().eval()
        before = (fingerprint(sender), fingerprint(receiver))
        batch = Game(182, 'validation').batch(16)
        with torch.inference_mode():
            tokens = sender(torch.from_numpy(batch.sender)).logits.argmax(-1)
            receiver(torch.from_numpy(batch.candidates), tokens).logits.argmax(-1)
        self.assertEqual(before, (fingerprint(sender), fingerprint(receiver)))
        self.assertTrue(all(p.grad is None for model in (sender, receiver) for p in model.parameters()))


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        init(671, threads=1)

    def test_deranged_messages_preserve_exact_marginals(self):
        rng = np.random.default_rng(1223)
        ids = np.array([0, 1, 1, 3, 7, 7, 7, 63])
        order = derangement(len(ids), rng)
        self.assertTrue(np.all(order != np.arange(len(ids))))
        np.testing.assert_array_equal(np.sort(order), np.arange(len(ids)))
        np.testing.assert_array_equal(np.bincount(ids, minlength=64), np.bincount(ids[order], minlength=64))
        with self.assertRaises(ValueError):
            derangement(1, rng)

    def test_intervals_have_known_degenerate_behavior(self):
        self.assertLess(wilson(0, 100)[0], .001)
        self.assertGreater(wilson(100, 100)[1], .999)
        all_correct = np.ones((8, 64), dtype=bool)
        interval = paired_interval(np.ones(8, dtype=bool), all_correct,
                                   np.arange(8), np.random.default_rng(98), samples=20)
        self.assertEqual(interval, [0, 0])

    def test_validation_evaluation_is_frozen_reproducible_and_auditable(self):
        sender, receiver = Sender().eval(), Receiver().eval()
        fingerprints = fingerprint(sender), fingerprint(receiver)
        first, evidence = measure(sender, receiver, 'validation', 4, episodes=32, bootstrap_samples=20)
        second, second_evidence = measure(sender, receiver, 'validation', 4, episodes=32, bootstrap_samples=20)
        self.assertEqual(first, second)
        self.assertEqual(fingerprints, (fingerprint(sender), fingerprint(receiver)))
        self.assertEqual(first['chance'], .25)
        self.assertEqual(set(first['metrics']), {'normal', 'shuffled', 'random', 'zero_embedding'})
        for key in evidence:
            np.testing.assert_array_equal(evidence[key], second_evidence[key])
        for intervention in first['metrics']:
            observed = int((evidence[f'choice_{intervention}'] == evidence['target']).sum())
            self.assertEqual(first['metrics'][intervention]['correct'], observed)
        self.assertEqual(sum(first['message_counts']), 32)
        self.assertEqual(np.asarray(first['usage_by_evaluator_type']).sum(), 32)
        self.assertTrue(np.all(evidence['shuffle_source_episode'] != np.arange(32)))
        self.assertTrue(all(p.grad is None for model in (sender, receiver) for p in model.parameters()))
        control, control_evidence = measure(None, receiver, 'validation', 4, episodes=32, bootstrap_samples=20)
        self.assertEqual(set(control['metrics']), {'receiver_only'})
        np.testing.assert_array_equal(control_evidence['target'], evidence['target'])
        np.testing.assert_array_equal(control_evidence['candidate_types'], evidence['candidate_types'])
        np.testing.assert_array_equal(control_evidence['choice_receiver_only'], evidence['choice_zero_embedding'])


class SealContractTests(unittest.TestCase):
    MODULE = 'scripts.pixel_language_lab.evaluate'
    SOURCE = 'frozen-test-source'

    def fixtures(self):
        records = []
        for seed in (17, 29, 43):
            for control in (False, True):
                config = dict(DEFAULT, seed=seed, control=control)
                records.append({'seed': seed, 'control': control, 'config': config,
                                'config_sha256': digest(config), 'source_sha256': self.SOURCE,
                                'split_sha256': digest(SPLIT_SPEC), 'status': 'completed',
                                'completed_steps': DEFAULT['steps']})
        return records

    def invoke(self, records, output):
        paths = [f'synthetic-checkpoint-{i}.pt' for i in range(len(records))]
        with patch(self.MODULE + '.load_checkpoint', side_effect=[(data, None, None) for data in records]), \
             patch(self.MODULE + '.file_digest', side_effect=lambda path: 'sha256:' + str(path)), \
             patch(self.MODULE + '.source_digest', return_value=self.SOURCE):
            seal(paths, output)

    def assert_rejected(self, records, message):
        with tempfile.TemporaryDirectory(prefix='aincrad-pixel-seal-test-') as temp:
            output = Path(temp) / 'seal.json'
            with self.assertRaisesRegex(ValueError, message):
                self.invoke(records, output)
            self.assertFalse(output.exists(), 'A rejected attempt must not produce a seal')

    def test_seal_rejects_effective_main_config_and_fingerprint_mismatches(self):
        records = self.fixtures()
        records[0]['config']['steps'] -= 1
        # Even a self-consistent hash cannot authorize a different main horizon.
        records[0]['config_sha256'] = digest(records[0]['config'])
        self.assert_rejected(records, 'effective config')
        records = self.fixtures()
        records[0]['config_sha256'] = 'wrong-config-fingerprint'
        self.assert_rejected(records, 'effective config')

    def test_seal_rejects_source_and_split_mismatches(self):
        for field in ('source_sha256', 'split_sha256'):
            with self.subTest(field=field):
                records = self.fixtures()
                records[2][field] = 'changed-after-training'
                self.assert_rejected(records, 'source/protocol/split')

    def test_seal_rejects_missing_or_duplicate_seed_role(self):
        self.assert_rejected(self.fixtures()[:-1], 'all six')
        records = self.fixtures()
        records[-1] = copy.deepcopy(records[-2])
        self.assert_rejected(records, 'all six')
        records = self.fixtures()
        records[-1]['seed'] = 99
        records[-1]['config']['seed'] = 99
        records[-1]['config_sha256'] = digest(records[-1]['config'])
        self.assert_rejected(records, 'all six')

    def test_seal_rejects_false_completion_nonterminal_and_unbounded_steps(self):
        records = self.fixtures()
        records[0]['completed_steps'] = DEFAULT['steps'] - 1
        self.assert_rejected(records, 'incomplete horizon')
        records = self.fixtures()
        records[0]['status'] = 'running'
        self.assert_rejected(records, 'not terminal')
        for count in (-1, DEFAULT['steps'] + 1):
            with self.subTest(completed_steps=count):
                records = self.fixtures()
                records[0]['status'], records[0]['completed_steps'] = 'failed', count
                self.assert_rejected(records, 'Invalid checkpoint completed step count')

    def test_seal_accepts_all_six_terminal_attempts_without_hiding_failures(self):
        records = self.fixtures()
        records[1]['status'], records[1]['completed_steps'] = 'timeout', 123
        records[2]['status'], records[2]['completed_steps'] = 'failed', 0
        with tempfile.TemporaryDirectory(prefix='aincrad-pixel-seal-test-') as temp:
            output = Path(temp) / 'seal.json'
            self.invoke(records, output)
            frozen_bytes = output.read_bytes()
            sealed = json.loads(frozen_bytes)
            self.assertEqual(len(sealed['checkpoints']), 6)
            self.assertEqual(sealed['evaluation_sha256'], digest(EVAL_SPEC))
            self.assertEqual(sealed['source_sha256'], self.SOURCE)
            self.assertEqual([entry['status'] for entry in sealed['checkpoints']],
                             ['completed', 'timeout', 'failed', 'completed', 'completed', 'completed'])
            self.assertEqual([entry['completed_steps'] for entry in sealed['checkpoints']],
                             [DEFAULT['steps'], 123, 0, DEFAULT['steps'], DEFAULT['steps'], DEFAULT['steps']])
            with self.assertRaises(FileExistsError):
                self.invoke(records, output)
            self.assertEqual(output.read_bytes(), frozen_bytes)


class ArtifactTests(unittest.TestCase):
    def test_one_step_checkpoint_records_state_and_cannot_overwrite(self):
        with tempfile.TemporaryDirectory(prefix='aincrad-pixel-unit-') as temp:
            output = Path(temp) / 'attempt'
            with patch('builtins.print'):
                result = train(output, 1234, steps=1, max_seconds=10)
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['completed_steps'], 1)
            self.assertGreater((output / 'checkpoint.pt').stat().st_size, 0)
            checkpoint = torch.load(output / 'checkpoint.pt', map_location='cpu', weights_only=True)
            for field in ('sender', 'receiver', 'optimizer', 'baseline', 'torch_rng', 'game_rng',
                          'config', 'config_sha256', 'split', 'split_sha256', 'source_sha256', 'seed'):
                self.assertIn(field, checkpoint)
            self.assertTrue(checkpoint['optimizer']['state'])
            loaded, sender, receiver = load_checkpoint(output / 'checkpoint.pt')
            self.assertEqual(loaded['seed'], 1234)
            self.assertFalse(sender.training)
            self.assertFalse(receiver.training)
            self.assertEqual(json.loads((output / 'attempt.json').read_text())['checkpoint_sha256'], result['checkpoint_sha256'])
            before = (output / 'checkpoint.pt').read_bytes()
            with self.assertRaises(FileExistsError):
                train(output, 1234, steps=1, max_seconds=10)
            self.assertEqual(before, (output / 'checkpoint.pt').read_bytes())


if __name__ == '__main__':
    unittest.main()

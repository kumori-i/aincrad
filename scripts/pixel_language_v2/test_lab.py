"""Engineering-only tests. Tiny temporary attempts are never research results."""
import inspect
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import torch
from . import common
from .common import CONFIG,init,fingerprint,source_digest,digest,write_json,effective_config
from .game import Game,render,ALL_RECTANGLES,TRAIN_RECTANGLES,NOVEL_RECTANGLES
from .models import Sender,Receiver,reinforce
from .train import make_models,train,selected_coefficient
from .evaluate import measure,derangement,select,seal,evaluate,load_checkpoint


class LabTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):init(808)

    def test_rectangle_contract_exhaustive(self):
        self.assertEqual((len(ALL_RECTANGLES),len(TRAIN_RECTANGLES),len(NOVEL_RECTANGLES)),(36,6,30))
        for r in ALL_RECTANGLES:
            self.assertEqual(len(set(r)),4)
            self.assertEqual(sorted(np.unique(np.array(r)//4,return_counts=True)[1]),[2,2])
            self.assertEqual(sorted(np.unique(np.array(r)%4,return_counts=True)[1]),[2,2])
            for factor in (lambda x:x//4,lambda x:x%4):
                # Every target has exactly two visually indistinguishable candidates under either factor.
                self.assertEqual(sum(1/sum(factor(t)==factor(c) for c in r) for t in r)/4,.5)
        self.assertTrue(all(all(t//4!=t%4 for t in r) for r in TRAIN_RECTANGLES))
        self.assertTrue(all(any(t//4==t%4 for t in r) for r in NOVEL_RECTANGLES))

    def test_uniform_targets_and_independent_views(self):
        b=Game([881,77],'train').batch(8192)
        self.assertTrue(np.all(abs(np.bincount(b.target,minlength=4)-2048)<200))
        self.assertFalse(np.array_equal(b.sender,b.candidates[np.arange(len(b.target)),b.target]))
        self.assertTrue(np.isfinite(b.sender).all());self.assertTrue((b.sender>=0).all());self.assertTrue((b.sender<=1).all())

    def test_rng_replay(self):
        g=Game(812,'train');g.batch(3);state=g.state();b=g.batch(10);g.restore(state);c=g.batch(10)
        for key in ('sender','candidates','target','types'):np.testing.assert_array_equal(getattr(b,key),getattr(c,key))
        with self.assertRaises(ValueError):g.restore({})

    def test_distinct_shapes_sampled(self):
        for novel in (False,True):
            sets=[]
            for shape in range(4):
                _,masks=render(np.full(4096,shape),np.random.default_rng([555,shape]),novel)
                packed=np.packbits(masks,axis=None).reshape(4096,32)
                sets.append({row.tobytes() for row in packed})
                self.assertTrue((masks.sum((1,2))>0).all())
            for a in range(4):
                for b in range(a+1,4):self.assertFalse(sets[a]&sets[b])

    def test_models_separate_and_control_matched(self):
        s,r=make_models(113,False);_,c=make_models(113,True)
        self.assertEqual(fingerprint(r),fingerprint(c))
        self.assertFalse({p.data_ptr() for p in s.parameters()}&{p.data_ptr() for p in r.parameters()})
        self.assertEqual(list(inspect.signature(s.forward).parameters),['pixels'])
        self.assertEqual(list(inspect.signature(r.forward).parameters),['candidates','tokens'])

    def test_reward_gradients_and_entropy_diagnostics(self):
        s,r=make_models(113,False);b=Game(444,'train').batch(64)
        loss,reward,stats=reinforce(s,r,b,.25,.02,.1);loss.backward()
        self.assertTrue(torch.isfinite(loss));self.assertTrue(0<=reward<=1)
        self.assertGreater(sum(p.grad.abs().sum().item() for p in s.encoder.parameters()),0)
        self.assertGreater(sum(p.grad.abs().sum().item() for p in r.encoder.parameters()),0)
        self.assertTrue(1<=stats['argmax_distinct_messages']<=64)
        self.assertTrue(0<=stats['sender_marginal_entropy']<=2*np.log(8)+1e-5)

    def test_receiver_permutation_equivariance(self):
        s,r=make_models(113,False);b=Game(9,'train').batch(12)
        pixels=torch.from_numpy(b.candidates);tokens=torch.zeros((12,2),dtype=torch.long);order=[3,0,2,1]
        torch.testing.assert_close(r(pixels,tokens).probs[:,order],r(pixels[:,order],tokens).probs)

    def test_derangement(self):
        rng=np.random.default_rng(8)
        for n in (2,3,10,128):
            p=derangement(n,rng);self.assertEqual(sorted(p),list(range(n)));self.assertTrue((p!=np.arange(n)).all())
        with self.assertRaises(ValueError):derangement(1,rng)

    def test_frozen_measure_counts_and_subsets(self):
        s,r=make_models(113,False);before=fingerprint(s),fingerprint(r)
        # Engineering-only stream, tiny evaluation is not used for selection.
        with patch.dict(CONFIG,{'evaluation_seed':9019283}):
            summary,e=measure(s,r,'validation',64,10)
        self.assertEqual(before,(fingerprint(s),fingerprint(r)))
        self.assertEqual(sum(summary['error_counts'].values()),64-summary['metrics']['normal']['correct'])
        self.assertEqual(summary['target_subsets']['seen']['episodes'],64)
        self.assertIsNone(summary['target_subsets']['unseen']['accuracy'])
        for name,metric in summary['metrics'].items():self.assertEqual(metric['correct'],int((e['choice_'+name]==e['target']).sum()))
        ids=e['message_id'];rows=np.arange(64)
        np.testing.assert_array_equal(e['choice_normal'],e['all_message_choices'][rows,ids])
        np.testing.assert_array_equal(e['choice_shuffled'],e['all_message_choices'][rows,ids[e['shuffle_source_episode']]])

    def test_control_measure(self):
        _,r=make_models(113,True)
        with patch.dict(CONFIG,{'evaluation_seed':9019283}):summary,e=measure(None,r,'validation',32,10)
        self.assertEqual(set(summary['metrics']),{'receiver_only'})

    def test_config_bounds(self):
        for args in ((113,False,.3,False),(99,False,.02,False),(107,True,.02,True),(113,False,.02,True)):
            with self.assertRaises(ValueError):effective_config(*args)
        for n in (0,8193):
            with self.assertRaises(ValueError):Game(9,'train').batch(n)
        with self.assertRaises(ValueError):Game(9,'unknown')

    def test_selection_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'selection.json'
            value={'source_sha256':source_digest(),'config_sha256':digest(CONFIG),'selected_coefficient':.02,
                   'pilots':[{'coefficient':.02,'score':.1},{'coefficient':.1,'score':.1}]}
            write_json(p,value);self.assertEqual(selected_coefficient(p),.02)
            value['selected_coefficient']=.1;write_json(p,value)
            with self.assertRaises(ValueError):selected_coefficient(p)
            value['selected_coefficient']=.02;value['pilots'][0]['score']=float('nan');write_json(p,value)
            with self.assertRaises(ValueError):selected_coefficient(p)

    def test_tiny_training_artifact_and_incomplete_rejection(self):
        with tempfile.TemporaryDirectory() as temp,patch.dict(CONFIG,{'pilot_steps':2}):
            folder=Path(temp)/'engineering-only'
            record=train(folder,107,.02,pilot=True)
            self.assertEqual(record['completed_steps'],2);self.assertEqual(record['status'],'completed')
            data,_,_=load_checkpoint(folder/'checkpoint.pt')
            self.assertIn('optimizer',data);self.assertIn('torch_rng',data);self.assertIn('game_rng',data)
            with self.assertRaises(FileExistsError):train(folder,107,.02,pilot=True)
            data['status']='timeout';torch.save(data,folder/'incomplete.pt')
            with self.assertRaises(ValueError):select([folder/'incomplete.pt'],Path(temp)/'selection.json')

    def test_main_requires_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):train(Path(temp)/'attempt',113,.02)

    def test_invalid_seal_and_final_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'seal.json';write_json(p,{'evaluation_sha256':'wrong','source_sha256':source_digest()})
            dummy=Path(temp)/'checkpoint';dummy.write_bytes(b'not a checkpoint')
            with self.assertRaises(ValueError):evaluate(dummy,Path(temp)/'out',p)
            self.assertFalse((Path(temp)/'out').exists())

    def test_engineering_only_full_artifact_pipeline(self):
        # Patched tiny horizons exercise serialization, never select research models.
        with tempfile.TemporaryDirectory() as temp,patch.dict(CONFIG,{'pilot_steps':1,'steps':1,
                'validation_episodes':16,'evaluation_episodes':16,'bootstrap_samples':5,'evaluation_seed':9019283}):
            root=Path(temp); pilots=[]
            for i,coefficient in enumerate(CONFIG['pilot_coefficients']):
                folder=root/f'pilot-{i}';train(folder,107,coefficient,pilot=True);pilots.append(folder/'checkpoint.pt')
            selection=root/'selection.json';result=select(pilots,selection)
            coefficient=result['selected_coefficient'];checkpoints=[]
            for seed in CONFIG['main_seeds']:
                for control in (False,True):
                    folder=root/f'run-{seed}-{control}'
                    train(folder,seed,coefficient,control,selection_path=selection);checkpoints.append(folder/'checkpoint.pt')
            with self.assertRaises(ValueError):seal(checkpoints[:-1],root/'bad-seal.json',selection)
            sealed=root/'seal.json';seal(checkpoints,sealed,selection)
            report=evaluate(checkpoints[0],root/'evaluation',sealed)
            self.assertTrue(report['cohort_complete']);self.assertEqual(len(report['results']),4)
            data=torch.load(checkpoints[0],weights_only=True);data['source_sha256']='invalid'
            torch.save(data,root/'wrong-source.pt')
            with self.assertRaises(ValueError):load_checkpoint(root/'wrong-source.pt')
            with self.assertRaises(FileExistsError):seal(checkpoints,sealed,selection)

    def test_no_runtime_imports(self):
        root=Path(__file__).parents[2]
        for folder in ('src','desktop'):
            for p in (root/folder).glob('*'):
                if p.is_file():self.assertNotIn('pixel_language_v2',p.read_text(errors='replace'))

if __name__=='__main__':unittest.main()

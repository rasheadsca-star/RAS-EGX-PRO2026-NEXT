import unittest, tempfile, json
from pathlib import Path
from scripts.v18.core import *
from scripts.v18.ledger import append, verify
from scripts.v18.validate import momentum_baseline
from scripts.v18.forward import freeze, verify_ledger

def rows(n=30):
    return [{'date':f'2026-07-{i+1:02d}','open':100.,'high':101.,'low':99.,'close':100.,'volume':10000.} for i in range(n)]

class V18DestructiveTests(unittest.TestCase):
    def test_missing_is_blocked_not_zero(self):
        self.assertEqual(data_gate({'ticker':'X','symbolVerified':True,'sessions':[]})['status'],'DATA_BLOCKED')
    def test_duplicate_session_fails_closed(self):
        r=rows(25); s={'ticker':'X','symbolVerified':True,'sessions':r+r[:1]}
        self.assertIn('DUPLICATE_SESSION',data_gate(s,1)['reasons'])
    def test_stale_last_session_fails_closed(self):
        s={'ticker':'X','symbolVerified':True,'sessions':rows(30)}
        gate=data_gate(s,1,required_last_session='2026-08-30')
        self.assertEqual(gate['status'],'DATA_BLOCKED'); self.assertIn('STALE_OHLCV',gate['reasons'])
    def test_bad_ohlc_is_rejected(self):
        r=rows(1)[0]; r['high']=98; self.assertFalse(valid_session(r))
    def test_same_bar_is_stop_first(self):
        r=rows(); r[21].update(high=110,low=90)
        self.assertEqual(label_event(r,20)['label'],'STOP_BEFORE_TARGET')
    def test_gap_down_is_no_entry(self):
        r=rows(); r[21].update(open=90,high=91,low=89,close=90)
        self.assertEqual(label_event(r,20)['label'],'NO_ENTRY')
    def test_probabilities_sum_to_one(self):
        p=Softmax(2).predict([0,0]); self.assertAlmostEqual(sum(p),1)
    def test_calibration_metrics_are_exact_for_perfect_predictions(self):
        p=[[1,0,0,0],[0,1,0,0]]; y=[0,1]
        self.assertEqual(brier(p,y),0); self.assertEqual(target_ece(p,y),0)
    def test_momentum_baseline_is_a_probability_distribution(self):
        e={'x':[0,0,.1,0,0,0,0]}; p=momentum_baseline([e],[.3,.2,.49,.01])[0]
        self.assertAlmostEqual(sum(p),1); self.assertGreater(p[0],.3)
    def test_research_authority_locked(self):
        r=recommendation('X','2026-01-01',(100,95,110),(.7,.1,.1,.1),.1,-.05,3)
        self.assertFalse(r['productionAuthority']); self.assertFalse(r['automaticOrders']); self.assertIn(r['decision'],DECISIONS)
    def test_unrealistic_target_is_vetoed(self):
        r=recommendation('X','2026-01-01',(100,95,150),(.8,.1,.1,0),.05,-.03,3)
        self.assertEqual(r['decision'],'VETO'); self.assertIn('TARGET_EXCEEDS_MFE_ENVELOPE',r['riskFlags'])
    def test_hash_chain_detects_tampering(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'ledger.json'; append(p,{'experimentId':'V18-E001','verdict':'REJECTED'})
            ledger=json.loads(p.read_text()); self.assertTrue(verify(ledger)); ledger['entries'][0]['verdict']='PASS'; self.assertFalse(verify(ledger))
    def test_duplicate_experiment_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'ledger.json'; append(p,{'experimentId':'V18-E001'})
            with self.assertRaises(ValueError): append(p,{'experimentId':'V18-E001'})
    def test_forward_snapshot_is_immutable(self):
        current={
            'artifactHash':'A',
            'model':{'id':'softmax-geometry-aware-2'},
            'recommendations':[{
                'ticker':'X','signalDate':'2026-08-30','decision':'WAIT',
                'entryLow':99,'entryHigh':101,'stop':95,'target':110,
                'pTargetBeforeStop':.6,'pStopBeforeTarget':.2,'pTimeExit':.1,'pNoEntry':.1,
                'expectedValue':.01,'targetRealistic':True,'stopRealistic':True,
                'modelVersion':'softmax-geometry-aware-2','featureVersion':'v18-features-2'
            }],
            'dataReadiness':[{'ticker':'X','lastSession':'2026-08-30'}]
        }
        _,ledger=freeze(current,{'entries':[]}); changed=json.loads(json.dumps(current)); changed['recommendations'][0]['target']=120
        with self.assertRaises(ValueError): freeze(changed,ledger)
        self.assertTrue(verify_ledger(ledger)); ledger['entries'][0]['portfolioDecision']='BUY'; self.assertFalse(verify_ledger(ledger))

if __name__=='__main__': unittest.main()

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('g11', 'astra/data-health/g11-v16-context.py')
g11 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g11)

class Integrity(unittest.TestCase):
    def test_missing_volume_rejection_and_conflicting_duplicates(self):
        good = dict(date='2026-10-20', open=10, high=11, low=9, close=10, volume=0)
        rows = [good, {**good, 'date':'2026-10-21', 'volume':None},
                {**good, 'date':'2026-10-22', 'warnings':['partial_ohlc_reconstructed_from_close']},
                {**good, 'date':'2026-10-23'}, {**good, 'date':'2026-10-23', 'close':10.5},
                {**good, 'date':'2026-10-24', 'validationStatus':'quarantined'}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'TEST.json'
            path.write_text(json.dumps(dict(ticker='TEST', symbolVerified=True, sessions=rows)))
            result = g11.norm_hist(path)
            self.assertTrue(result['ok'])
            self.assertEqual([row['date'] for row in result['rows']], ['2026-10-20'])

    def test_outcome_labels_include_next_day_risk_rejected_security(self):
        # 62 market dates, 60 securities. Tomorrow's base_feature is absent
        # for T00; its observed loss must remain a label for today's signal.
        from datetime import date, timedelta
        days = [(date(2026, 1, 1)+timedelta(days=i)).isoformat() for i in range(62)]
        histories = {}
        for n in range(60):
            ticker=f'T{n:02}'
            histories[ticker]={'ticker':ticker,'ok':True,'rows':[
                {'date':day,'open':10,'high':11,'low':1,'close':1 if n==0 and i==61 else 10,'volume':100} for i,day in enumerate(days)]}
        original = {key:getattr(g11,key) for key in ['active_tickers','norm_hist','base_feature','augment_feature','extended_flags','extended_vector','effective_model_support','technical_snapshot']}
        original_min = g11.SRC['MIN_SIGNAL_SESSIONS']
        try:
            g11.active_tickers=lambda:set(histories)
            g11.norm_hist=lambda path:histories[path.stem]
            g11.base_feature=lambda h,i:None if h['ticker']=='T00' and i==61 else {'ticker':h['ticker'],'date':h['rows'][i]['date'],'close':10,'ret20':0,'momentumFailureRisk':0,'turn':1,'rsi':50,'ret5':0,'breakout':0,'a14':1}
            g11.augment_feature=lambda h,i,f:f
            g11.extended_flags=lambda f:[0]*8
            g11.extended_vector=lambda f,flags:[0]*2
            g11.effective_model_support=lambda *args:0
            g11.technical_snapshot=lambda *args:{}
            g11.SRC['MIN_SIGNAL_SESSIONS']=1
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                (root/'data/history').mkdir(parents=True)
                (root/'data/session-calendar.json').write_text(json.dumps({'sessions':days}))
                for ticker in histories:(root/'data/history'/f'{ticker}.json').touch()
                oldroot=g11.ROOT; g11.ROOT=root
                try: result=g11.build(days[-1])
                finally:g11.ROOT=oldroot
            row=next(row for row in result['trainingSessions'][-1] if row['ticker']=='T00')
            self.assertEqual(row['nextReturn'],-90)
            self.assertEqual(row['outcomeSessionDate'],days[-1])
        finally:
            for key,value in original.items():setattr(g11,key,value)
            g11.SRC['MIN_SIGNAL_SESSIONS']=original_min

if __name__=='__main__':unittest.main()

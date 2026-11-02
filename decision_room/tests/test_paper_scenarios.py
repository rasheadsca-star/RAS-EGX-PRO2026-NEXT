import unittest
import pandas as pd
from decision_room.egx_decision.paper_scenarios import propose

class PaperScenariosTest(unittest.TestCase):
 def test_no_trend_means_no_levels(self):
  g=pd.DataFrame({"close":[100+i for i in range(60)]})
  p=propose(g,{"trend":False,"adv20":2000000,"ma20":140})
  self.assertEqual(p["scenarios"],[])
  self.assertFalse(p["tradable"])
 def test_paper_only_without_tick(self):
  g=pd.DataFrame({"close":[100+i*.4 for i in range(60)]})
  p=propose(g,{"trend":True,"adv20":2000000,"ma20":120})
  self.assertFalse(p["tradable"])
  self.assertFalse(p["tick_verified"])
  for x in p["scenarios"]:
   self.assertFalse(x["executable"])
   self.assertLess(x["stop_raw"],x["entry_raw"])
 def test_future_does_not_change_past(self):
  g=pd.DataFrame({"close":[100+i*.4 for i in range(60)]})
  ind={"trend":True,"adv20":2000000,"ma20":120}
  self.assertEqual(propose(g,ind),propose(pd.concat([g,pd.DataFrame({"close":[999]})]).iloc[:-1],ind))
if __name__=="__main__":unittest.main()

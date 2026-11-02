import unittest,sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
from egx_decision.execution_checks import tick_round,cost_stress,verification_gate
class ExecutionChecksTest(unittest.TestCase):
 def test_no_tick_no_execution(self):
  self.assertFalse(verification_gate("AJWA","2026-11-01",[])["tick_verified"])
  with self.assertRaises(ValueError):tick_round(1.234,None,"entry")
 def test_round_direction(self):
  self.assertEqual(tick_round(1.2345,.01,"entry"),1.24)
  self.assertEqual(tick_round(1.2345,.01,"stop"),1.23)
 def test_stress(self):
  z=cost_stress(100,95,110,20000)
  self.assertLess(z["stop_net_egp"],-1000)
  self.assertLess(z["target_net_egp"],2000)
  self.assertFalse(z["validated"])
 def test_dated_verified_only(self):
  self.assertFalse(verification_gate("AJWA","2026-11-01",[{"ticker":"AJWA","session":"2026-10-29","tick":0.01,"official_verified":True}])["tick_verified"])
if __name__=="__main__":unittest.main()

import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location("eligibility",pathlib.Path(__file__).with_name("research_price_eligibility.py"))
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class EligibilityTests(unittest.TestCase):
    def test_bad_raw(self):self.assertEqual(mod.classify(0,1,[]),"BLOCK_INVALID_RAW_CLOSE")
    def test_reconstructed(self):self.assertEqual(mod.classify(10,10,["partial_ohlc_reconstructed_from_close_or_previous_close"]),"BLOCK_RECONSTRUCTED_OHLC")
    def test_divergent_adjustment(self):self.assertEqual(mod.classify(10,9,[]),"RAW_RESEARCH_ONLY_PROVIDER_ADJUSTMENT_CONFLICT")
    def test_missing_adjustment(self):self.assertEqual(mod.classify(10,None,[]),"RAW_RESEARCH_ONLY_NO_ADJUSTED_PROOF")
    def test_matching_still_unapproved(self):self.assertEqual(mod.classify(10,10,[]),"RAW_RESEARCH_ONLY_MATCHING_ADJUSTED")
if __name__=="__main__":unittest.main()

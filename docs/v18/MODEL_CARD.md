# Model card — V18.0 baseline

- Model: four-class multinomial logistic regression (softmax), deliberately simpler than tree/deep models.
- Labels: target-before-stop, stop-before-target, time exit, no entry.
- Entry begins on the following session; gaps below stop produce NO_ENTRY; same-bar ambiguity is STOP_FIRST.
- Validation: chronological baseline only. It is not yet a blind holdout or formal forward pass.
- Limitations: daily bars, single-source histories in parts of the universe, incomplete point-in-time fundamentals, no intraday sequence proof, and no production authority.

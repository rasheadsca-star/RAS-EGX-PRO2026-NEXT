# Target engine

The baseline target is the greater of one ATR above entry and prior 20-session structural resistance plus a small volatility buffer. Target distance is supplied to the probability model because its difficulty is known at signal time. A fail-closed realism governor vetoes a target outside 1.5× the ticker's trailing expected-MFE envelope (with a 3% floor). This is deliberately not a fixed ATR target alone. Future versions may replace it only through a separately versioned, pre-registered MFE-quantile experiment.

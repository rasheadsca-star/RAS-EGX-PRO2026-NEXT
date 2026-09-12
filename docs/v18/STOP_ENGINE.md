# Stop engine

The baseline stop is the lower of a volatility allowance and the recent 10-session structural low minus a buffer. Stop distance is supplied to the probability model and a fail-closed governor vetoes stops outside the expected-MAE envelope. It is frozen at signal time. Daily-bar target/stop collisions resolve as `STOP_FIRST`.

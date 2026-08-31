# Session Contract
Each scan resolves the latest completed EGX session through exchange-calendar logic plus validated data availability. A scan consumes exactly one immutable Session Manifest. If sufficient data for that session is unavailable, engine state is DATA_NOT_READY and old recommendations are not presented as current.

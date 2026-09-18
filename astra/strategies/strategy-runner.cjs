'use strict';

/**
 * Public strategy-runner boundary. Delegates byte-for-byte semantics to the
 * certified G08 implementation while preventing active consumers from
 * importing reconstruction internals directly.
 */
const core=require('./g08-final-overlay.cjs');
const registry=require('./strategy-registry.cjs');

function executeStrategy(strategyId,input){return core.executeStrategy(strategyId,input)}
function executeRegisteredStrategy(strategyId,input){return executeStrategy(strategyId,input)}
function strategyAvailable(strategyId){return registry.hasStrategy(strategyId)}

module.exports=Object.freeze({
  executeStrategy,
  executeRegisteredStrategy,
  strategyAvailable,
  crossSectionIdentity:core.crossSectionIdentity
});

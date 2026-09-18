'use strict';

/**
 * Public strategy-registry boundary.
 * G08 reconstruction files are private implementation details.
 */
const {SPECS:CORE_SPECS}=require('./g08-final-overlay.cjs');

function listStrategyIds(){return Object.keys(CORE_SPECS)}
function getStrategyDescriptor(strategyId){return CORE_SPECS[String(strategyId||'')]||null}
function listStrategyDescriptors(){return listStrategyIds().map(getStrategyDescriptor)}
function hasStrategy(strategyId){return Boolean(getStrategyDescriptor(strategyId))}

module.exports=Object.freeze({listStrategyIds,listStrategyDescriptors,getStrategyDescriptor,hasStrategy});

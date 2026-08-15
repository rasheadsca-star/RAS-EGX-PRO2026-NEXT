(() => {
  'use strict';
  // Compatibility entrypoint retained because app.js already loads native-research.js.
  // Native is now a discovery/research layer inside the canonical V17-centric Decision Board.
  if (window.__V20_DECISION_BOARD_LOADER__) return;
  window.__V20_DECISION_BOARD_LOADER__ = true;

  if (!document.querySelector('link[data-v20-decision-board]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './decision-board.css';
    link.dataset.v20DecisionBoard = 'true';
    document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-v20-decision-board]')) {
    const script = document.createElement('script');
    script.src = './decision-board.js';
    script.defer = true;
    script.dataset.v20DecisionBoard = 'true';
    document.body.appendChild(script);
  }
})();

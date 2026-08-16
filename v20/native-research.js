(() => {
  'use strict';
  // Compatibility loader only.
  // The canonical V17-centric Decision Board remains loaded directly by v20/index.html.
  // This file may load research/display overlays, but must never inject core decision-board assets or alter execution logic.
  window.__V20_NATIVE_RESEARCH_COMPAT__ = true;

  if (!document.querySelector('link[data-v20-consensus-overlay]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './consensus-overlay.css';
    link.dataset.v20ConsensusOverlay = 'true';
    document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-v20-consensus-overlay]')) {
    const script = document.createElement('script');
    script.src = './consensus-overlay.js';
    script.defer = true;
    script.dataset.v20ConsensusOverlay = 'true';
    document.body.appendChild(script);
  }
})();

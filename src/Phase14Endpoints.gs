/** Public Phase 14 entry points. */
function phase14Api_() { return new Phase14Api(); }
function getDashboardMetrics(numberId) { return phase14Api_().getDashboardMetrics(numberId); }

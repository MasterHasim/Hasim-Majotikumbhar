/** Public Phase 3 entry points. No doGet/doPost — HTTP webhook wiring is Phase 4's job. */
function phase3Api_() { return new Phase3Api(); }
function createNumber(input) { return phase3Api_().createNumber(input); }
function updateNumber(id, patch) { return phase3Api_().updateNumber(id, patch); }
function listNumbers() { return phase3Api_().listNumbers(); }

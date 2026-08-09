/** Phase 8: default lead stages (data, not hardcoded business logic — the roadmap's
 * suggested initial set). Seeded once via seedDefaultLeadStages(), not auto-created,
 * so an admin can freely edit/replace them afterward. */
var Phase8DefaultStages = [
  { key: 'new', name: 'New' },
  { key: 'contacted', name: 'Contacted' },
  { key: 'interested', name: 'Interested' },
  { key: 'quotation_sent', name: 'Quotation Sent' },
  { key: 'negotiation', name: 'Negotiation' },
  { key: 'won', name: 'Won' },
  { key: 'lost', name: 'Lost' }
];

/** UI options share the exact values of the PostgreSQL pipeline_stage enum. */
export const STAGES = [
  ['new_lead', 'Ny kunde', 'New lead'],
  ['contacted', 'Kontaktet', 'Contacted'],
  ['qualified', 'Kvalificeret', 'Qualified'],
  ['booked', 'Booket', 'Booked'],
  ['dire_escalated', 'Akut', 'Emergency'],
  ['closed_won', 'Vundet', 'Won'],
  ['closed_lost', 'Tabt', 'Lost'],
] as const;

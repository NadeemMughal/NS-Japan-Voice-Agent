/**
 * Runs n8n/src/lead_normalize.js with a stubbed n8n runtime.
 *
 *   node scripts/test_lead_normalize.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'n8n', 'src', 'lead_normalize.js'), 'utf8');

const CONFIG = {
  ghl_location_id: 'loc_TEST123',
  ghl_pipeline_id: '',
  ghl_pipeline_stage_id: '',
};

function runNormalize(args, call = {}, config = CONFIG) {
  const nodes = {
    'Retell Webhook': { json: { body: { name: 'capture_lead', call, args } } },
    Config: { json: config },
  };
  const $ = (name) => ({ first: () => nodes[name] });
  const sandbox = { $, console, JSON, Number, Math, String, Array, Object, Boolean, Date };
  return vm.runInNewContext(`(function(){${code}})()`, sandbox)[0].json;
}

let pass = 0;
let fail = 0;
function check(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? '  ->  ' + detail : ''}`);
  }
}

console.log('\n--- capture_lead normalisation tests ---\n');

// A complete, well-formed lead
let r = runNormalize(
  {
    full_name: 'James Mwangi Kariuki',
    email: 'James.Mwangi@Gmail.com ',
    phone: '+254 712 345 678',
    country: 'Kenya',
    city_or_port: 'Mombasa',
    interest_type: 'vehicle_in_stock',
    vehicle_interest: '2010 Toyota Alphard automatic',
    stock_id: 'NS10632',
    budget_usd: 7000,
    timeline: 'within a month',
    notes: 'Wants CIF to Mombasa. Asked about JEVIC inspection.',
  },
  { call_id: 'call_abc123', from_number: '+254700000000' }
);

check('first name split', r.contact.firstName === 'James', r.contact.firstName);
check('last name split keeps the rest', r.contact.lastName === 'Mwangi Kariuki', r.contact.lastName);
check('email lowercased and trimmed', r.contact.email === 'james.mwangi@gmail.com', r.contact.email);
check('phone stripped to E.164', r.contact.phone === '+254712345678', r.contact.phone);
check('country mapped to ISO2', r.contact.country === 'KE', r.contact.country);
check('city carried through', r.contact.city === 'Mombasa', r.contact.city);
check('locationId injected from Config', r.contact.locationId === 'loc_TEST123');
check('source set for CRM attribution', r.contact.source === 'Retell Voice Agent');
check('tagged only as NS Japan Lead',
  r.contact.tags.length === 1 && r.contact.tags[0] === 'NS Japan Lead', r.contact.tags.join(','));
check('note contains the vehicle interest', /Toyota Alphard/.test(r.note));
check('note contains the agent notes', /JEVIC/.test(r.note));
check('note records the Retell call id', /call_abc123/.test(r.note));
check('opportunity value is the budget', r.opportunity.monetaryValue === 7000);
check('no pipeline configured is reported', r.hasPipeline === false);
check('lead summary is populated', r.lead_summary.name === 'James Mwangi Kariuki' && r.lead_summary.budget_usd === 7000);

// Email spoken aloud and mis-transcribed
r = runNormalize({ full_name: 'Ana Lopez', email: 'ana (at) yahoo (dot) com', interest_type: 'vehicle_sourcing' });
check('spoken "(at)" / "(dot)" email is repaired', r.contact.email === 'ana@yahoo.com', r.contact.email);

// Garbage email must not reach the CRM
r = runNormalize({ full_name: 'Bad Email', email: 'not an email at all', interest_type: 'general_enquiry' });
check('malformed email is dropped, not sent', r.contact.email === undefined, JSON.stringify(r.contact.email));
check('missing email still gets only the lead tag',
  r.contact.tags.length === 1 && r.contact.tags[0] === 'NS Japan Lead', r.contact.tags.join(','));
check('missing email is recorded in the note', /Email: not given/.test(r.note));

// No phone given - fall back to caller ID
r = runNormalize(
  { full_name: 'Peter Banda', interest_type: 'vehicle_sourcing' },
  { from_number: '+260977123456' }
);
check('phone falls back to caller ID', r.contact.phone === '+260977123456', r.contact.phone);

// Phone without a plus
r = runNormalize({ full_name: 'Test User', phone: '254712345678', interest_type: 'general_enquiry' });
check('bare international number gets a plus', r.contact.phone === '+254712345678', r.contact.phone);

// Single-word name
r = runNormalize({ full_name: 'Madonna', interest_type: 'general_enquiry' });
check('single-word name does not break', r.contact.firstName === 'Madonna' && r.contact.lastName === '');

// Missing name entirely
r = runNormalize({ interest_type: 'general_enquiry' });
check('missing name falls back safely', r.contact.name === 'Unknown caller', r.contact.name);

// Unmapped country must not send a bad ISO code
r = runNormalize({ full_name: 'X Y', country: 'Wakanda', interest_type: 'general_enquiry' });
check('unknown country is omitted rather than guessed', r.contact.country === undefined);
check('unknown country still recorded in the note', /Destination country: Wakanda/.test(r.note));

// Already-ISO country
r = runNormalize({ full_name: 'X Y', country: 'ZA', interest_type: 'general_enquiry' });
check('ISO2 country passed through', r.contact.country === 'ZA');

// Pipeline configured
r = runNormalize(
  { full_name: 'Pipe Line', interest_type: 'vehicle_in_stock', budget_usd: 12000 },
  {},
  { ghl_location_id: 'loc_1', ghl_pipeline_id: 'pipe_1', ghl_pipeline_stage_id: 'stage_1' }
);
check('pipeline configured is detected', r.hasPipeline === true);
check('pipeline + stage carried into opportunity',
  r.opportunity.pipelineId === 'pipe_1' && r.opportunity.pipelineStageId === 'stage_1');
check('budget over 10k carried into opportunity', r.opportunity.monetaryValue === 12000);

// Auto parts lead
r = runNormalize({
  full_name: 'Sam Osei',
  interest_type: 'auto_parts',
  vehicle_interest: 'front bumper for 2009 Honda Fit',
  country: 'Ghana',
});
check('auto parts interest recorded in the note', /Interest: auto_parts/.test(r.note));
check('opportunity name describes the request', /front bumper/.test(r.opportunity.name), r.opportunity.name);
check('Ghana mapped to GH', r.contact.country === 'GH');

// Opportunity name must stay within GHL limits
r = runNormalize({
  full_name: 'Very Long Name Indeed',
  interest_type: 'vehicle_sourcing',
  vehicle_interest: 'x'.repeat(400),
});
check('opportunity name truncated to 120 chars', r.opportunity.name.length <= 120, String(r.opportunity.name.length));

console.log(`\n--- ${pass} passed, ${fail} failed ---\n`);
if (fail > 0) process.exit(1);

/**
 * Regenerates docs/GHL-LEAD-MAPPING.md by running a representative call through the
 * real normaliser, so the documentation cannot drift from the code.
 *
 *   node scripts/sample_lead.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'n8n', 'src', 'lead_normalize.js'), 'utf8');

const SAMPLE_ARGS = {
  full_name: 'James Mwangi Kariuki',
  email: 'james.mwangi@example.com',
  phone: '+254 712 345 678',
  country: 'Kenya',
  city_or_port: 'Mombasa',
  interest_type: 'vehicle_in_stock',
  vehicle_interest: '2010 Toyota Alphard, automatic, around 6000 USD',
  stock_id: 'NS10632',
  budget_usd: 6500,
  timeline: 'within a month',
  notes:
    'Buying for a family transport business. Asked about JEVIC inspection and CIF to Mombasa.',
};

const SAMPLE_CALL = { call_id: 'call_9f2b', from_number: '+254700111222' };

const nodes = {
  'Retell Webhook': {
    json: { body: { name: 'capture_lead', call: SAMPLE_CALL, args: SAMPLE_ARGS } },
  },
  Config: {
    json: {
      ghl_location_id: '<YOUR_LOCATION_ID>',
      ghl_pipeline_id: '<PIPELINE_ID>',
      ghl_pipeline_stage_id: '<STAGE_ID>',
    },
  },
};

const $ = (name) => ({ first: () => nodes[name] });
const out = vm.runInNewContext(`(function(){${code}})()`, {
  $, console, JSON, Number, Math, String, Array, Object, Boolean, Date,
})[0].json;

const md = `# What a captured lead looks like in GoHighLevel

Generated from \`n8n/src/lead_normalize.js\` with a representative call, so this page
cannot drift from the code. Regenerate with:

\`\`\`bash
node scripts/sample_lead.js
\`\`\`

## 1. Contact upsert

\`POST https://services.leadconnectorhq.com/contacts/upsert\`

Headers: \`Authorization: Bearer <private integration token>\`, \`Version: 2021-07-28\`

\`\`\`json
${JSON.stringify(out.contact, null, 2)}
\`\`\`

Upsert matches on email or phone, so a repeat caller updates their existing contact
instead of creating a duplicate.

## 2. Note attached to the contact

\`POST /contacts/{contactId}/notes\`

\`\`\`
${out.note}
\`\`\`

## 3. Opportunity

\`POST /opportunities/\`

Only created when \`ghl_pipeline_id\` is set in the workflow's **Config** node. Leave it
blank and the workflow creates just the contact and the note.

\`\`\`json
${JSON.stringify(out.opportunity, null, 2)}
\`\`\`

## Tags applied

${out.contact.tags.map((t) => '- `' + t + '`').join('\n')}

Every voice lead carries the single tag \`NS Japan Lead\`, so one GoHighLevel smart list
filtered on it shows them all. Interest, country, budget and stock number live in the
note; a lead whose note reads \`Email: not given\` needs a phone follow-up.

## Data quality rules applied on the way in

- The name is split into first and last; a single-word name does not break it.
- The email is lowercased, and spoken forms like \`name (at) gmail (dot) com\` are
  repaired. An address that still does not look valid is **dropped rather than sent**,
  and the note records \`Email: not given\`.
- The phone is reduced to digits and a leading \`+\`; if the caller gave no number, the
  caller ID is used instead.
- The destination country is mapped to the ISO-2 code GoHighLevel expects. A country
  that is not in the map is left off the contact rather than guessed, but still appears
  in the note.
- The opportunity name is truncated to 120 characters.
`;

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'GHL-LEAD-MAPPING.md'), md);
console.log('wrote docs/GHL-LEAD-MAPPING.md');

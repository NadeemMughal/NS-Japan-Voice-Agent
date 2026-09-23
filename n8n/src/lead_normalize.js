// Turns the Retell capture_lead payload into the shapes GoHighLevel expects.
// Output: one item carrying the contact body, the note body, the opportunity body
// and a short confirmation string for the voice agent.

const webhook = $('Retell Webhook').first().json;
const body = webhook.body || webhook || {};
const args = body.args || {};
const call = body.call || {};
const cfg = $('Config').first().json;

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const has = (v) => str(v) !== '';

// ---------------------------------------------------------------- name
const fullName = str(args.full_name) || 'Unknown caller';
const nameParts = fullName.split(/\s+/).filter(Boolean);
const firstName = nameParts[0] || 'Unknown';
const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

// ---------------------------------------------------------------- contact details
let email = str(args.email).toLowerCase().replace(/\s+/g, '');
// Voice transcription often writes "name at gmail dot com".
email = email
  .replace(/\(at\)|\[at\]/g, '@')
  .replace(/\(dot\)|\[dot\]/g, '.');
if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  email = ''; // Do not push a malformed address into the CRM.
}

let phone = str(args.phone).replace(/[^\d+]/g, '');
if (phone && !phone.startsWith('+') && phone.length > 6) phone = '+' + phone;
// Fall back to the caller ID when the caller did not read out a number.
if (!phone) phone = str(call.from_number);

// ---------------------------------------------------------------- country
const COUNTRY_ISO = {
  'kenya': 'KE', 'tanzania': 'TZ', 'uganda': 'UG', 'zambia': 'ZM',
  'zimbabwe': 'ZW', 'mozambique': 'MZ', 'malawi': 'MW', 'botswana': 'BW',
  'namibia': 'NA', 'south africa': 'ZA', 'nigeria': 'NG', 'ghana': 'GH',
  'congo': 'CD', 'drc': 'CD', 'rwanda': 'RW', 'burundi': 'BI',
  'ethiopia': 'ET', 'somalia': 'SO', 'sudan': 'SD', 'mauritius': 'MU',
  'pakistan': 'PK', 'india': 'IN', 'bangladesh': 'BD', 'sri lanka': 'LK',
  'uae': 'AE', 'united arab emirates': 'AE', 'dubai': 'AE',
  'saudi arabia': 'SA', 'oman': 'OM', 'qatar': 'QA', 'bahrain': 'BH',
  'kuwait': 'KW', 'jordan': 'JO', 'iraq': 'IQ',
  'united kingdom': 'GB', 'uk': 'GB', 'england': 'GB', 'ireland': 'IE',
  'australia': 'AU', 'new zealand': 'NZ', 'fiji': 'FJ',
  'papua new guinea': 'PG', 'solomon islands': 'SB',
  'chile': 'CL', 'peru': 'PE', 'bolivia': 'BO', 'paraguay': 'PY',
  'guyana': 'GY', 'suriname': 'SR',
  'jamaica': 'JM', 'trinidad and tobago': 'TT', 'dominica': 'DM',
  'dominican republic': 'DO', 'bahamas': 'BS', 'barbados': 'BB',
  'guyana ': 'GY', 'haiti': 'HT', 'cuba': 'CU',
  'russia': 'RU', 'georgia': 'GE', 'kazakhstan': 'KZ', 'mongolia': 'MN',
  'myanmar': 'MM', 'philippines': 'PH', 'japan': 'JP',
};
const countryRaw = str(args.country);
const countryIso = /^[A-Za-z]{2}$/.test(countryRaw)
  ? countryRaw.toUpperCase()
  : COUNTRY_ISO[countryRaw.toLowerCase()] || '';

// ---------------------------------------------------------------- tags
// Every lead carries one tag. Interest, country, budget and stock number are in the note.
const interest = str(args.interest_type) || 'general_enquiry';
const budget = Number(args.budget_usd);
const tags = ['NS Japan Lead'];

// ---------------------------------------------------------------- contact body
const contact = {
  locationId: cfg.ghl_location_id,
  firstName,
  lastName,
  name: fullName,
  source: 'Retell Voice Agent',
  tags,
};
if (email) contact.email = email;
if (phone) contact.phone = phone;
if (countryIso) contact.country = countryIso;
if (has(args.city_or_port)) contact.city = str(args.city_or_port);

// ---------------------------------------------------------------- note
const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const noteLines = [
  'NS JAPAN AUTOS - VOICE AGENT LEAD',
  'Captured: ' + when,
  '',
  'Name: ' + fullName,
  'Email: ' + (email || 'not given'),
  'Phone: ' + (phone || 'not given'),
  'Destination country: ' + (countryRaw || 'not given'),
  'Nearest port / city: ' + (str(args.city_or_port) || 'not given'),
  '',
  'Interest: ' + interest,
  'Looking for: ' + (str(args.vehicle_interest) || 'not specified'),
  'Stock number: ' + (str(args.stock_id) || 'none selected'),
  'Budget (USD): ' + (Number.isFinite(budget) && budget > 0 ? budget.toLocaleString('en-US') : 'not given'),
  'Timeline: ' + (str(args.timeline) || 'not given'),
  '',
  'Agent notes: ' + (str(args.notes) || 'none'),
];
if (str(call.call_id)) {
  noteLines.push('', 'Retell call ID: ' + str(call.call_id));
}
if (str(call.from_number)) {
  noteLines.push('Caller ID: ' + str(call.from_number));
}
const note = noteLines.join('\n');

// ---------------------------------------------------------------- opportunity
const oppName =
  fullName +
  ' - ' +
  (str(args.vehicle_interest) || str(args.stock_id) || interest.replace(/_/g, ' '));

const opportunity = {
  pipelineId: cfg.ghl_pipeline_id || '',
  locationId: cfg.ghl_location_id,
  name: oppName.slice(0, 120),
  status: 'open',
  source: 'Retell Voice Agent',
};
if (cfg.ghl_pipeline_stage_id) opportunity.pipelineStageId = cfg.ghl_pipeline_stage_id;
if (Number.isFinite(budget) && budget > 0) opportunity.monetaryValue = budget;

const hasPipeline = Boolean(cfg.ghl_pipeline_id && String(cfg.ghl_pipeline_id).trim());

return [
  {
    json: {
      contact,
      note,
      opportunity,
      hasPipeline,
      lead_summary: {
        name: fullName,
        email: email || null,
        phone: phone || null,
        country: countryRaw || null,
        interest,
        stock_id: str(args.stock_id) || null,
        budget_usd: Number.isFinite(budget) && budget > 0 ? budget : null,
      },
    },
  },
];

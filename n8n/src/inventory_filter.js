// Filters the NS Japan Autos stock snapshot against the arguments Retell sent.
// Input: the snapshot JSON from the "Fetch Stock Snapshot" node.
// Output: a single item that is returned verbatim to the Retell agent.

const webhook = $('Retell Webhook').first().json;
const body = webhook.body || webhook || {};
const args = body.args || {};

let snapshot = {};
try {
  snapshot = $('Fetch Stock Snapshot').first().json || {};
} catch (e) {
  snapshot = {};
}
// A text/plain response arrives unparsed as {data: "<json string>"}.
if (!Array.isArray(snapshot.vehicles) && typeof snapshot.data === 'string') {
  try {
    snapshot = JSON.parse(snapshot.data);
  } catch (e) {
    snapshot = { error: 'stock snapshot is not valid JSON' };
  }
}

// If the snapshot host is unreachable the agent must not improvise a stock list.
// Tell it plainly what it can and cannot say.
if (!Array.isArray(snapshot.vehicles) || snapshot.vehicles.length === 0) {
  return [
    {
      json: {
        ok: false,
        total_matches: 0,
        returned: 0,
        vehicles: [],
        summary_for_agent:
          'The stock list could not be reached just now. Do NOT name any vehicle, ' +
          'price or stock number - you have no data. Tell the caller you cannot pull ' +
          'the live list up this moment, take their details and what they are looking ' +
          'for, and tell them a specialist will email the matching vehicles with prices.',
        // Keep this short. Everything returned here is fed to the LLM, and a full
        // stack trace is both noise and a waste of the response budget.
        error: (() => {
          const e = snapshot.error;
          if (!e) return 'stock snapshot unavailable or empty';
          const msg = typeof e === 'string' ? e : e.message || String(e);
          return String(msg).split('\n')[0].slice(0, 160);
        })(),
      },
    },
  ];
}

let vehicles = snapshot.vehicles;

const norm = (s) => String(s === undefined || s === null ? '' : s).trim().toLowerCase();
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
// Letters and digits only, so "Mercedes-Benz" meets "MERCEDES BENZ" and "E Class" meets "E-CLASS".
const squash = (s) => norm(s).replace(/[^a-z0-9]/g, '');

// Callers abroad use export names; the site lists Japanese-market names. A caller asking
// for a "Corolla" wants to hear about the Fielder and Axio, which are Corollas in Japan.
const MODEL_ALIASES = {
  corolla: ['fielder', 'axio', 'rumion', 'spacio', 'runx', 'allex'],
  yaris: ['vitz'],
  jazz: ['fit'],
  vellfire: ['alphard'],
  alphard: ['vellfire'],
  noah: ['voxy', 'esquire'],
  voxy: ['noah', 'esquire'],
  premio: ['allion'],
  allion: ['premio'],
  '4runner': ['hiluxsurf'],
  montero: ['pajero'],
};
// Aliases are a fallback: a caller who names a Premio exactly gets Premios, not Allions too.
const byName = (list, names, fields) =>
  list.filter((v) => names.some((w) => fields(v).some((f) => f.includes(w))));
const matchName = (list, s, fields) => {
  const w = squash(s);
  const direct = byName(list, [w], fields);
  return direct.length || !MODEL_ALIASES[w] ? direct : byName(list, MODEL_ALIASES[w], fields);
};

// An exact stock number beats every other filter.
if (has(args.stock_id)) {
  const want = norm(args.stock_id).replace(/\s+/g, '');
  vehicles = vehicles.filter((v) => norm(v.stock_id).replace(/\s+/g, '') === want);
} else {
  if (has(args.make)) {
    const want = squash(args.make);
    vehicles = vehicles.filter((v) => squash(v.make).includes(want) || want.includes(squash(v.make)));
  }
  if (has(args.model)) {
    vehicles = matchName(vehicles, args.model, (v) => [squash(v.model), squash(v.title)]);
  }
  if (has(args.body_type)) {
    const want = norm(args.body_type);
    vehicles = vehicles.filter((v) => {
      const bt = norm(v.body_type);
      if (bt === want) return true;
      // Tolerate loose phrasing: "minivan" vs "Mini Van / 1 Box", "hatch" vs "HatchBack".
      return squash(bt).includes(squash(want)) || squash(want).includes(squash(bt));
    });
  }
  if (has(args.transmission)) {
    const want = norm(args.transmission);
    vehicles = vehicles.filter((v) => norm(v.transmission).includes(want));
  }
  if (has(args.fuel)) {
    const want = norm(args.fuel);
    vehicles = vehicles.filter((v) => norm(v.fuel).includes(want));
  }
  if (has(args.steering)) {
    const want = norm(args.steering);
    vehicles = vehicles.filter((v) => norm(v.steering) === want);
  }
  if (has(args.keyword)) {
    const hay = (v) => [squash(v.title) + ' ' + squash(v.make) + ' ' + squash(v.model) + ' ' + squash(v.body_type)];
    for (const word of norm(args.keyword).split(/\s+/).filter((w) => squash(w))) {
      vehicles = matchName(vehicles, word, hay);
    }
  }
}

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const priceMin = num(args.price_min);
const priceMax = num(args.price_max);
const yearMin = num(args.year_min);
const yearMax = num(args.year_max);

if (priceMin !== null) vehicles = vehicles.filter((v) => num(v.price_usd) >= priceMin);
if (priceMax !== null) vehicles = vehicles.filter((v) => num(v.price_usd) <= priceMax);
if (yearMin !== null) vehicles = vehicles.filter((v) => num(v.year) >= yearMin);
if (yearMax !== null) vehicles = vehicles.filter((v) => num(v.year) <= yearMax);

const totalMatches = vehicles.length;

// With a budget, the most useful answer is the best vehicle they can afford, so show the
// dearest first. Without one, lead with the cheapest.
vehicles = vehicles.slice().sort((a, b) => {
  const pa = num(a.price_usd) || 0;
  const pb = num(b.price_usd) || 0;
  return priceMax !== null ? pb - pa : pa - pb;
});

let limit = num(args.limit);
if (limit === null || limit < 1) limit = 3;
limit = Math.min(limit, 5);

const results = vehicles.slice(0, limit).map((v) => ({
  stock_id: v.stock_id,
  title: v.title,
  year: v.year,
  make: v.make,
  model: v.model,
  body_type: v.body_type || null,
  price_usd: v.price_usd,
  mileage_km: v.mileage_km || null,
  mileage_note: v.mileage_km ? 'approximate, confirmed by the sales team' : null,
  transmission: v.transmission || null,
  fuel: v.fuel || null,
  engine: v.engine || null,
  colour: v.color || null,
  steering: v.steering || null,
  seats: v.seats || null,
  doors: v.doors || null,
  chassis: v.chassis || null,
  location: v.location || null,
  url: v.url,
}));

const usd = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

let spoken;
// Which narrowing filters the agent sent, so a miss can say what to relax.
const narrowing = ['model', 'keyword', 'body_type', 'transmission', 'fuel', 'steering',
  'price_min', 'price_max', 'year_min', 'year_max'].filter((k) => has(args[k]));

if (totalMatches === 0 && !has(args.stock_id) && narrowing.length > 0) {
  spoken =
    'Nothing matches those exact filters (' + narrowing.join(', ') + '). Do not go to ' +
    'sourcing yet. Search again more broadly - drop the year and price limits, or search ' +
    'the make alone, or the body type alone - and offer the caller the closest vehicles ' +
    'we do have. Only offer sourcing if the broader search also finds nothing suitable, ' +
    'or the caller says none of the alternatives will do.';
} else if (totalMatches === 0) {
  spoken =
    'No vehicles in the published stock list match that. Tell the caller honestly that ' +
    'nothing listed matches right now, mention we hold over twelve thousand vehicles ' +
    'across our network, and offer to have the team source it for them.';
} else {
  const lines = results.map(
    (v) =>
      `${v.year} ${v.make} ${v.model} - ${usd(v.price_usd)} FOB, ` +
      `${v.mileage_km ? 'about ' + v.mileage_km.toLocaleString('en-US') + ' km, ' : ''}` +
      `${v.transmission || ''}` +
      `${v.fuel ? ', ' + v.fuel : ''}, stock number ${v.stock_id}`
  );
  spoken =
    `${totalMatches} vehicle${totalMatches === 1 ? '' : 's'} match. ` +
    `Showing ${results.length}: ` +
    lines.join(' | ') +
    '. Read these out naturally, say prices as words, and do not read the stock number ' +
    'unless the caller asks for it.';
}

return [
  {
    json: {
      ok: true,
      total_matches: totalMatches,
      returned: results.length,
      filters_applied: args,
      stock_last_updated: snapshot.crawled_at || null,
      vehicles: results,
      summary_for_agent: spoken,
      pricing_note:
        'All prices are FOB - the vehicle only. Freight, insurance, duties and port ' +
        'clearing are not included and must be quoted by the sales team.',
      mileage_note:
        'Mileage figures are approximate. Say them as a round number, for example ' +
        '"about one hundred thousand kilometres", and tell the caller the sales team ' +
        'confirms exact mileage on the quote.',
    },
  },
];

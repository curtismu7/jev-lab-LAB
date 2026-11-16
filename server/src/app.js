// One Express app. /api = the JEV lab: scenarios, single judgments, bake-offs, the threshold policy slider.
// Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites, scanHosts, scanKeys } from './safety.js';
import { createHealth, DEMO } from './health.js';
import { SCENARIOS, DECIDERS, rulesDecide, modelDecide } from './decisions.js';
import { GUARDRAIL_CORPUS, INTENT_CORPUS } from './corpora.js';
import { DIAGRAM_NAMES, loadDiagram } from './diagramData.js';
import { createMode, MODES } from './mode.js';
import { realDecide } from './realModel.js';
import { shelfInfo } from './shelfLink.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });
export const BANNER = (source) => source === 'real'
  ? 'REAL mode. Judgments go to the configured decision-model API with the owner\'s key. The bake-off corpora stay simulated.'
  : 'MOCK mode. SIMULATED: the decision model is a deterministic feature scorer, not an LLM. No tenant, no outbound network, no paid API.';
const LIMITS = { text: 300, stepUpAt: [0, 1], denyAt: [0, 1] };
const STEP_UP_DEFAULT = 0.4;
const DENY_DEFAULT = 0.9;

const cleanInput = (v) => String(v ?? '').slice(0, LIMITS.text);
const thresholds = (body) => {
  const stepUpAt = Number(body?.stepUpAt ?? STEP_UP_DEFAULT);
  const denyAt = Number(body?.denyAt ?? DENY_DEFAULT);
  if (!Number.isFinite(stepUpAt) || !Number.isFinite(denyAt) || stepUpAt < LIMITS.stepUpAt[0] || stepUpAt > LIMITS.stepUpAt[1] || denyAt < LIMITS.denyAt[0] || denyAt > LIMITS.denyAt[1]) return null;
  if (stepUpAt > denyAt) return null;
  return { stepUpAt, denyAt };
};

export function createApp({ health = createHealth(), mode = createMode() } = {}) {
  let epoch = 0; // counts resets
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '16kb' }));
  api.use('/health', health.router);
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...mode.info(), version: DEMO.version || null, banner: BANNER(mode.source()), epoch }); });
  // Rule 19: POST /api/mode with exactly {"source": "mock"|"real"}. Real unconfigured -> 409 with the how-to.
  api.post('/mode', (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || !MODES.includes(b.source)) return bad(res, 'body must be exactly {"source": "mock" or "real"}');
    if (b.source === 'real' && mode.info().realAvailable !== true) return res.status(409).json({ error: 'conflict', message: mode.info().realReason });
    mode.set(b.source);
    return res.json({ ...mode.info(), version: DEMO.version || null, banner: BANNER(mode.source()), epoch });
  });

  api.get('/diagram', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const name = DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0];
    return res.json(loadDiagram(name));
  });
  api.get('/catalog', (_req, res) => res.json({
    banner: BANNER(mode.source()), source: mode.source(), limits: LIMITS,
    scenarios: Object.values(SCENARIOS).map(({ key, kind, question, choices, choiceLabels, about, howUsed }) => ({ key, kind, question, choices, choiceLabels, about, howUsed })),
    deciders: DECIDERS,
  }));

  // POST /api/judge { scenario, text, stepUpAt?, denyAt? } -> both deciders on the same text.
  api.post('/judge', async (req, res) => {
    const { scenario } = req.body || {};
    if (typeof scenario !== 'string' || !SCENARIOS[scenario]) return bad(res, 'scenario must be one of ' + Object.keys(SCENARIOS).join(', '));
    const text = cleanInput(req.body?.text);
    if (!text.trim()) return bad(res, 'text is required');
    const th = thresholds(req.body);
    if (!th) return bad(res, 'stepUpAt and denyAt must be numbers in [0,1] with stepUpAt <= denyAt');
    const rules = rulesDecide(scenario, text);
    let model = modelDecide(scenario, text);
    if (mode.source() === 'real') {
      try { model = { ...(await realDecide(scenario, text)), policy: undefined }; }
      catch (e) { return res.status(502).json({ error: 'real_unavailable', message: e.message }); }
    }
    const policy = (score) => (score >= th.denyAt ? 'deny' : score >= th.stepUpAt ? 'stepup' : 'allow');
    const safety = [...scanHosts(text), ...scanKeys(text)];
    if (safety.length) return bad(res, 'text must not carry hosts or key-looking strings');
    return res.json({
      banner: BANNER(mode.source()), scenario, text, thresholds: th, epoch,
      source: mode.source(),
      rules: { ...rules, policy: policy(rules.score) },
      model: { ...model, policy: policy(model.score) },
    });
  });

  // POST /api/bakeoff { corpus: 'guardrail' | 'intent', stepUpAt?, denyAt? } -> both deciders over the whole corpus + readout.
  api.post('/bakeoff', (req, res) => {
    const corpusName = req.body?.corpus === 'intent' ? 'intent' : 'guardrail';
    const corpus = corpusName === 'intent' ? INTENT_CORPUS : GUARDRAIL_CORPUS;
    const th = thresholds(req.body);
    if (!th) return bad(res, 'stepUpAt and denyAt must be numbers in [0,1] with stepUpAt <= denyAt');
    const policy = (score) => (score >= th.denyAt ? 'deny' : score >= th.stepUpAt ? 'stepup' : 'allow');
    const scenario = corpusName === 'intent' ? 'intent' : 'injection';
    const rows = corpus.map((row) => ({
      ...row,
      rules: rulesDecide(scenario, row.text),
      model: modelDecide(scenario, row.text),
    }));
    const readout = corpusName === 'intent'
      ? intentReadout(rows)
      : guardrailReadout(rows, th);
    return res.json({ banner: BANNER(mode.source()), corpus: corpusName, source: mode.source(), simulated: true, thresholds: th, total: rows.length, rows, readout, epoch });
  });

  api.post('/reset', (_req, res) => { epoch += 1; res.json({ ok: true, epoch }); });

  if (fs.existsSync(WEB_DIST)) app.use(express.static(WEB_DIST));
  // A tiny favicon so the browser stops 404ing on every load.
  app.get('/favicon.ico', (_req, res) => { res.set('Content-Type', 'image/svg+xml'); res.set('Cache-Control', 'public, max-age=86400'); res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="%23b33"/><path d="M3 12 6 4h1.5l3 8H9l-.6-1.8H5.6L5 12zm3-3 1-3 1 3z" fill="white"/></svg>'); });
  app.use('/api', api);
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  return app;
}

/** rows: { bad, rules: {verdict}, model: {score} } -> the two kinds of mistake per decider. */
export function guardrailReadout(rows, th) {
  const missed = (verdictOk) => rows.filter((r) => r.bad && verdictOk(r)).map((r) => r.text);
  const falseAlarms = (verdictOk) => rows.filter((r) => !r.bad && !verdictOk(r)).map((r) => r.text);
  return {
    rules: { missed: missed((r) => r.rules.verdict === 'ok'), falseAlarms: falseAlarms((r) => r.rules.verdict === 'ok') },
    model: { missed: missed((r) => r.model.policy === 'allow'), falseAlarms: falseAlarms((r) => r.model.verdict !== 'bad') },
    note: 'A missed attack reaches the tool; a false alarm only costs the customer an extra step. The step-up band can turn a high score into a challenge instead of a hard deny.',
  };
}

/** rows: { truth, rules: {verdict}, model: {verdict, score} } -> each decider's wrong picks. */
export function intentReadout(rows) {
  const wrong = (r, k) => (r[k].verdict !== r.truth ? { text: r.text, got: r[k].verdict, conf: r[k].score } : null);
  return {
    rules: rows.map((r) => wrong(r, 'rules')).filter(Boolean),
    model: rows.map((r) => wrong(r, 'model')).filter(Boolean),
    note: 'A wrong pick with high confidence is worse than a wrong pick the router flags as unsure.',
  };
}

// The bake-off: run both deciders over a hand-labelled corpus and count the two kinds of
// mistake. A missed attack reaches the tool; a false alarm costs the customer an extra step.
// The bake-off always uses the simulated model (labelled), whatever the header toggle says.
import { useState } from "react";
import { bakeoff } from "../lib/api.js";

const truthText = (r, corpus) => (corpus === "intent" ? r.truth.replace("_", " ") : r.bad ? "hostile" : "fine");
const gotText = (r, d, corpus) => {
  const v = r[d];
  if (!v) return "—";
  if (corpus === "intent") return String(v.verdict ?? "—").replace("_", " ");
  return v.verdict === "bad" ? "blocked" : "passed";
};
const isWrong = (r, d, corpus) => {
  if (!r[d]) return false;
  return corpus === "intent" ? r[d].verdict !== r.truth : (r.bad ? r[d].verdict === "ok" : r[d].verdict === "bad");
};

export default function BakeoffTab({ thresholds, onNotify }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (corpus) => {
    setBusy(true); setError(null);
    try { setResult(await bakeoff(corpus, thresholds)); onNotify?.(`${corpus} bake-off done.`); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <section aria-label="Bake-off" className="stack">
      <p className="muted">
        Same hand-labelled rows through both deciders. Labels were fixed before any decider ran;
        the app reports accuracy on these rows only — it is not a benchmark of any product.
        The bake-off always uses the simulated model, even in Real mode (it is the baseline).
      </p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => run("guardrail")} disabled={busy} data-testid="bakeoff-guardrail">Run the guardrail bake-off (8 rows)</button>
        <button type="button" className="btn" onClick={() => run("intent")} disabled={busy} data-testid="bakeoff-intent">Run the intent bake-off (8 rows)</button>
      </div>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {result ? (
        <div data-testid="bakeoff-result">
          <h3>{result.corpus === "intent" ? "Intent routing" : "Prompt-injection guardrail"} — {result.total} rows</h3>
          <table className="bakeoff">
            <thead><tr><th scope="col">Text</th><th scope="col">Truth</th><th scope="col">Rules</th><th scope="col">Model (SIMULATED)</th></tr></thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.text} data-testid="bakeoff-row">
                  <td>{r.text}</td>
                  <td>{truthText(r, result.corpus)}</td>
                  <td data-state={isWrong(r, "rules", result.corpus) ? "bad" : "ok"}>{gotText(r, "rules", result.corpus)}</td>
                  <td data-state={isWrong(r, "model", result.corpus) ? "bad" : "ok"}>{gotText(r, "model", result.corpus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Readout readout={result.readout} corpus={result.corpus} />
        </div>
      ) : <p className="muted" role="status">Run a bake-off to see where the keyword filter and the model disagree.</p>}
    </section>
  );
}

function Readout({ readout, corpus }) {
  const cols = corpus === "intent"
    ? [
        { name: "Keyword rules", wrong: readout.rules, testid: "rules-wrong" },
        { name: "Decision model (SIMULATED)", wrong: readout.model, testid: "model-wrong" },
      ]
    : [
        { name: "Keyword rules", wrong: [...readout.rules.missed.map((t) => ({ text: t })), ...readout.rules.falseAlarms.map((t) => ({ text: t }))], testid: "rules-wrong" },
        { name: "Decision model (SIMULATED)", wrong: [...readout.model.missed.map((t) => ({ text: t })), ...readout.model.falseAlarms.map((t) => ({ text: t }))], testid: "model-wrong" },
      ];
  return (
    <div className="readout" data-testid="bakeoff-readout">
      {cols.map((c) => (
        <div key={c.name} className="readout__col">
          <h4>{c.name}</h4>
          <p>Wrong on <strong data-testid={c.testid}>{c.wrong.length}</strong> of 8 rows</p>
          {c.wrong.length ? (
            <ul className="muted small">
              {c.wrong.map((x) => <li key={x.text}>{x.text.length > 60 ? `“${x.text.slice(0, 60)}…”` : `“${x.text}”`}{x.got ? <> → {String(x.got).replace("_", " ")}</> : null}</li>)}
            </ul>
          ) : <p className="muted small">Nothing.</p>}
        </div>
      ))}
      <p className="muted small">{readout.note}</p>
    </div>
  );
}

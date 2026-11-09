import React, { useCallback, useEffect, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import { getCatalog, getInfo, judge, requestModeSwitch, resetServer } from "./lib/api.js";
import ModeToggle from "./components/ModeToggle.jsx";
// Opened from Customer Agent LAB (UC-LEARN15 routes here): strip + header Back only. Nothing is preselected.
import ReturnLink from "./return-link/ReturnLink.jsx";
import JudgeTab from "./tabs/JudgeTab.jsx";
import BakeoffTab from "./tabs/BakeoffTab.jsx";

export const TABS = [["judge", "Judge"], ["bakeoff", "Bake-off"]];
export const FALLBACK_BANNER = "MOCK mode. SIMULATED: the decision model is a deterministic feature scorer, not an LLM. No tenant, no outbound network.";
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "judge"; };
const typing = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [scenario, setScenario] = useState("injection");
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("jevl.theme", "")) ? read("jevl.theme", "") : "system"));
  const [present, setPresent] = useState(() => read("jevl.present", "0") === "1");
  const [thresholds, setThresholds] = useState(() => ({ stepUpAt: Number(read("jevl.stepup", "0.4")), denyAt: Number(read("jevl.deny", "0.9")) }));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [announce, setAnnounce] = useState("");

  const loadAll = useCallback(async () => {
    const [c, i] = await Promise.all([getCatalog(), getInfo()]);
    setCatalog(c); setInfo(i);
    return i;
  }, []);
  useEffect(() => { loadAll().catch((e) => setLoadError(e.message)); }, [loadAll]);
  useEffect(() => { const on = () => setTab(tabFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => { if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (present) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present; }, [present]);
  useEffect(() => { write("jevl.stepup", String(thresholds.stepUpAt)); write("jevl.deny", String(thresholds.denyAt)); }, [thresholds]);
  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "p" || e.key === "P") setPresent((v) => { write("jevl.present", v ? "0" : "1"); return !v; });
      else if (e.key === "Escape") setPresent((v) => { if (v) write("jevl.present", "0"); return false; });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const onJudge = useCallback(async (scenarioKey, text) => {
    setBusy(true); setError(null);
    try {
      const r = await judge(scenarioKey, text, thresholds);
      setResult(r);
      setAnnounce(`Rules: ${r.rules.verdict}, ${r.rules.policy}. Model: ${r.model.verdict}, ${r.model.policy}.`);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }, [thresholds]);

  const onMode = useCallback(async (next) => {
    try {
      const r = await requestModeSwitch(next);
      setInfo(r);
      setAnnounce(r.message ?? `Mode: ${r.source}.`);
      const c = await getCatalog(); setCatalog(c); // reload all data after a switch (rule 19)
    } catch (e) { setAnnounce(e.message); }
  }, []);

  const banner = info?.banner ?? FALLBACK_BANNER;

  if (loadError || !catalog) {
    return (
      <>
        <a className="skip" href="#main">Skip to content</a>
        <header><p className="banner">{FALLBACK_BANNER}</p></header>
        <main className="page" id="main" tabIndex={-1}>
          {loadError ? <p className="alert" role="alert">Could not reach the lab server: {loadError}</p> : <p className="muted" role="status">Loading the decision lab...</p>}
        </main>
      </>
    );
  }

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header>
        <p className="banner" data-testid="banner">{banner}</p>
        <ReturnLink app="jev-lab" />
        <div className="head">
          <h1 className="head__title">JEV Decision Model LAB</h1>
          <div className="head__tools">
            <ReturnLink app="jev-lab" variant="header" />
            <ShelfLink />
            <ModeToggle info={info} onSelect={onMode} />
            <label className="inline">Theme
              <select value={theme} onChange={(e) => { const t = e.target.value; setTheme(t); try { localStorage.setItem("jevl.theme", t); } catch { /* not remembered */ } }} data-testid="theme">
                <option value="system">Auto</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <button type="button" className="btn" aria-pressed={present} onClick={() => setPresent((v) => { write("jevl.present", v ? "0" : "1"); return !v; })}>Present</button>
            <button type="button" className="btn" onClick={async () => { await resetServer(); setAnnounce("Server state reset."); }}>Reset</button>
          </div>
        </div>
        <nav aria-label="Tabs" className="tabs">
          {TABS.map(([id, label]) => <a key={id} href={`#/${id}`} aria-current={tab === id ? "page" : undefined} className="tab">{label}</a>)}
        </nav>
        <div className="seg scenarios" role="group" aria-label="Scenario">
          {catalog.scenarios.map((s) => (
            <button key={s.key} type="button" className="chip" aria-pressed={scenario === s.key} data-testid={`scenario-${s.key}`}
              onClick={() => { setScenario(s.key); setTab("judge"); window.location.hash = "#/judge"; }}>
              {s.label ?? s.key}
            </button>
          ))}
        </div>
      </header>
      <main className="page" id="main" tabIndex={-1}>
        {tab === "judge"
          ? <JudgeTab catalog={catalog} scenario={scenario} onScenario={setScenario} thresholds={thresholds} setThresholds={setThresholds} onJudge={onJudge} result={result} busy={busy} error={error} />
          : <BakeoffTab thresholds={thresholds} onNotify={setAnnounce} />}
      </main>
      <footer><p className="muted small">{catalog.deciders.map((d) => d.label).join(" vs ")}. Scores are one input to policy — never permission by themselves.</p></footer>
      <div aria-live="polite" className="visually-hidden">{announce}</div>
    </>
  );
}

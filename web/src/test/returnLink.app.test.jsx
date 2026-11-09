// Opened from Customer Agent LAB (UC-LEARN15 routes here): the strip and the header Back button show; nothing is preselected.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { returnLinkFor } from "../return-link/returnTargets.js";

vi.mock("../lib/api.js", () => ({
  requestModeSwitch: vi.fn(),
  getCatalog: vi.fn(async () => ({
    banner: "B", mode: "mock",
    scenarios: [
      { key: "injection", label: "Prompt injection", kind: "score", question: "q1", about: "a1", howUsed: "u1" },
      { key: "intent", label: "Intent routing", kind: "choice", question: "q2", about: "a2", howUsed: "u2", choices: ["check_balance", "other"] },
    ],
    deciders: [{ id: "rules", label: "Keyword rules" }, { id: "model", label: "Decision model (SIMULATED)" }],
  })),
  getInfo: vi.fn(async () => ({ source: "mock", realAvailable: false, realReason: "x", banner: "B", epoch: 0 })),
  resetServer: vi.fn(async () => ({ ok: true, epoch: 1 })),
  judge: vi.fn(), bakeoff: vi.fn(),
}));
import App from "../App.jsx";

const NOTE = { name: "Opened from Customer Agent LAB" };
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("return link", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link");
    const text = fs.readFileSync(path.join(dir, "return-link.sha256"), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f).toBe(h);
  });

  it("?from=customer-agent: banner first, strip right below, header Back in the tools", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC-LEARN15&vertical=banking");
    render(<App />);
    const note = await screen.findByRole("note", NOTE);
    expect(note.textContent).toContain("UC-LEARN15");
    expect(screen.getByTestId("banner").nextElementSibling).toBe(note);
    expect(document.querySelector(".head__tools > button.return-link--header")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
  });

  it("no from, an unknown from or a bad id: no strip, no button", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC-LEARN15", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC-LEARN15&vertical=a%20b"]) {
      window.history.replaceState(null, "", q);
      render(<App />);
      await screen.findByTestId("banner");
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      expect(screen.queryByRole("note")).toBeNull();
      cleanup();
    }
  });

  it("Back goes to the proxy path behind the lab proxy, to the direct URL on the app's own port", () => {
    window.history.replaceState(null, "", "/jev-lab/?from=customer-agent&uc=UC-LEARN15");
    expect(returnLinkFor("jev-lab").href).toBe("/customer-agent/?returned=jev-lab&uc=UC-LEARN15");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC-LEARN15");
    expect(returnLinkFor("jev-lab").href).toBe("http://127.0.0.1:5603/?returned=jev-lab&uc=UC-LEARN15");
  });
});

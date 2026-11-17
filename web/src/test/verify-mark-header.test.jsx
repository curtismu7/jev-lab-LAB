import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("../lib/api.js", () => ({
  getTalkTrack: vi.fn(async () => ({ talkTrack: [] })),
  requestModeSwitch: vi.fn(),
  getCatalog: vi.fn(async () => ({
    banner: "B", mode: "mock",
    scenarios: [{ key: "injection", label: "Prompt injection", kind: "score", question: "q1", about: "a1", howUsed: "u1" }],
    deciders: [{ id: "rules", label: "Keyword rules" }, { id: "model", label: "Decision model (SIMULATED)" }],
  })),
  getInfo: vi.fn(async () => ({ source: "mock", realAvailable: false, realReason: "x", banner: "B", epoch: 0 })),
  resetServer: vi.fn(async () => ({ ok: true, epoch: 1 })),
  judge: vi.fn(), bakeoff: vi.fn(),
}));
import App from "../App.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const real = globalThis.fetch;
function withShelf(payload) {
  globalThis.fetch = (url, init) => (url === "/api/shelf" ? Promise.resolve(new Response(JSON.stringify(payload))) : (real ? real(url, init) : Promise.reject(new Error("no fetch"))));
}
beforeEach(() => { window.location.hash = ""; });
afterEach(() => { cleanup(); globalThis.fetch = real; });

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "jev-lab", verification: mark("verified", "Verified", { note: "Both bake-offs run on the mock" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Both bake-offs run on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "jev-lab", verification: null }] }]) {
      withShelf(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});

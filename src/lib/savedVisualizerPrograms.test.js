import test from "node:test";
import assert from "node:assert/strict";
import { savedVisualizerPrograms } from "./savedVisualizerPrograms.js";

test("saved JavaScript files are grouped under their notebooks, including empty notebooks", () => {
  const groups = savedVisualizerPrograms([
    { _id: "qa", name: "QA", files: [] },
    {
      _id: "prime",
      name: "Prime",
      files: [
        { id: "a", name: "prime.js", content: "console.log(7);" },
        { id: "b", name: "module.MJS", content: "export const x = 1;" },
        { id: "c", name: "node.cjs", content: "let n = 3;" },
        { id: "d", name: "notes.md", content: "notes" },
        { id: "e", name: "style.css", content: "body {}" },
      ],
    },
  ]);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["QA", "Prime"],
  );
  assert.equal(groups[0].programs.length, 0);
  assert.deepEqual(
    groups[1].programs.map((program) => program.fileName),
    ["prime.js", "module.MJS", "node.cjs"],
  );
  assert.equal(groups[1].programs[0].notebookName, "Prime");
});

test("identical filenames and file IDs in different books remain independently selectable", () => {
  const groups = savedVisualizerPrograms([
    {
      _id: "one",
      name: "Book",
      files: [{ id: "main", name: "main.js", content: "console.log(1)" }],
    },
    {
      _id: "two",
      name: "Book",
      files: [{ id: "main", name: "main.js", content: "console.log(2)" }],
    },
    {
      _id: "one:main",
      name: "Other",
      files: [{ id: 'two:"main"', name: "main.js", content: "console.log(3)" }],
    },
  ]);
  const programs = groups.flatMap((group) => group.programs);
  assert.equal(new Set(programs.map((program) => program.key)).size, 3);
  for (let i = 0; i < 3; i++) {
    const selected = programs.find(
      (program) => program.key === programs[i].key,
    );
    assert.equal(selected.source, `console.log(${i + 1})`);
  }
});

test("opening files preserves saved content exactly and never mutates notebook data", () => {
  const source = "\n  // saved formatting\r\nconst x = 'hi';\r\n\n";
  const notebooks = [
    {
      _id: "saved",
      name: "Delete",
      files: [
        { id: "one", name: "remove.js", content: source },
        { id: "empty", name: "empty.js", content: "" },
      ],
    },
  ];
  const original = JSON.stringify(notebooks);
  const groups = savedVisualizerPrograms(notebooks);
  assert.equal(groups[0].programs[0].source, source);
  assert.equal(groups[0].programs[1].source, "");
  groups[0].programs[0].source = "changed locally";
  assert.equal(JSON.stringify(notebooks), original);
});

test("missing file lists and non-array responses are handled without blocking examples", () => {
  assert.deepEqual(savedVisualizerPrograms(null), []);
  assert.deepEqual(savedVisualizerPrograms({ error: "unavailable" }), []);
  const groups = savedVisualizerPrograms([
    null,
    { name: "no ID" },
    { _id: "a", files: null },
  ]);
  assert.deepEqual(groups, [
    { id: "a", name: "Untitled notebook", programs: [] },
  ]);
});

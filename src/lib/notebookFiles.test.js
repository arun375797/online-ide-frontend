import test from "node:test";
import assert from "node:assert/strict";
import { renameNotebookFile, uniqueFileName } from "./notebookFiles.js";

test("renaming preserves file identity, open tabs, selection, and unsaved source", () => {
  const notebook = {
    _id: "book",
    name: "Prime",
    activeFileId: "one",
    openFileIds: ["one", "two"],
    files: [
      { id: "one", name: "old.js", content: "saved code" },
      { id: "two", name: "helper.js", content: "saved helper" },
    ],
  };
  const original = JSON.stringify(notebook);
  const renamed = renameNotebookFile(notebook, "one", "new name.js", {
    one: "unsaved editor code",
    two: "unsaved helper code",
  });
  assert.equal(renamed.files[0].name, "new name.js");
  assert.equal(renamed.files[0].id, "one");
  assert.equal(renamed.files[0].content, "unsaved editor code");
  assert.equal(renamed.files[1].content, "unsaved helper code");
  assert.equal(renamed.activeFileId, "one");
  assert.deepEqual(renamed.openFileIds, ["one", "two"]);
  assert.equal(renamed._id, "book");
  assert.equal(renamed.name, "Prime");
  assert.equal(JSON.stringify(notebook), original);
});

test("renaming another file leaves the active file selected and preserves empty edits", () => {
  const notebook = {
    activeFileId: "one",
    files: [
      { id: "one", name: "active.js", content: "old" },
      { id: "two", name: "helper.js", content: "helper" },
    ],
  };
  const renamed = renameNotebookFile(notebook, "two", "utility.js", {
    one: "",
  });
  assert.equal(renamed.activeFileId, "one");
  assert.equal(renamed.files[0].content, "");
  assert.equal(renamed.files[1].content, "helper");
  assert.equal(renamed.files[1].name, "utility.js");
});

test("rename keeps existing extension and collision behavior without colliding with itself", () => {
  const files = [
    { id: "one", name: "prime.js" },
    { id: "two", name: "Prime-2.js" },
    { id: "three", name: "other.js" },
  ];
  assert.equal(uniqueFileName(files, "prime.js", "one"), "prime.js");
  assert.equal(uniqueFileName(files, "PRIME.js", "three"), "PRIME-3.js");
  assert.equal(uniqueFileName(files, "  new file  ", "three"), "new file.js");
  assert.equal(uniqueFileName(files, "module.mjs", "three"), "module.mjs");
});

test("blank names and missing files fail before changing notebook data", () => {
  const notebook = { files: [{ id: "one", name: "a.js", content: "code" }] };
  const original = JSON.stringify(notebook);
  assert.throws(
    () => renameNotebookFile(notebook, "one", "   "),
    /enter a name/,
  );
  assert.throws(
    () => renameNotebookFile(notebook, "missing", "new.js"),
    /no longer exists/,
  );
  assert.equal(JSON.stringify(notebook), original);
});

import { describe, expect, it } from "vitest";
import { buildFolderTree, validateFolderParent } from "./folder-hierarchy";
import type { OperationFolder } from "@/types";

function makeFolder(overrides: Partial<OperationFolder>): OperationFolder {
  return {
    id: "folder-1",
    account_id: "acct-1",
    parent_folder_id: null,
    name: "Folder",
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateFolderParent", () => {
  it("allows a root-level folder (no parent)", () => {
    expect(validateFolderParent([], "a", null)).toBeNull();
  });

  it("rejects a folder becoming its own parent", () => {
    expect(validateFolderParent([], "a", "a")).toContain("própria pasta-mãe");
  });

  it("rejects nesting under a folder that is already a subfolder", () => {
    const folders = [
      makeFolder({ id: "root" }),
      makeFolder({ id: "sub", parent_folder_id: "root" }),
    ];
    expect(validateFolderParent(folders, "new", "sub")).toContain("1 nível de subpasta");
  });

  it("rejects reparenting a folder that already has children", () => {
    const folders = [
      makeFolder({ id: "root-a" }),
      makeFolder({ id: "root-b" }),
      makeFolder({ id: "child", parent_folder_id: "root-a" }),
    ];
    expect(validateFolderParent(folders, "root-a", "root-b")).toContain("já tem subpastas");
  });

  it("allows nesting a childless folder under a root folder", () => {
    const folders = [makeFolder({ id: "root-a" }), makeFolder({ id: "root-b" })];
    expect(validateFolderParent(folders, "root-b", "root-a")).toBeNull();
  });
});

describe("buildFolderTree", () => {
  it("groups subfolders under their root, sorted by position", () => {
    const folders = [
      makeFolder({ id: "root", position: 0 }),
      makeFolder({ id: "child-2", parent_folder_id: "root", position: 1 }),
      makeFolder({ id: "child-1", parent_folder_id: "root", position: 0 }),
    ];
    const tree = buildFolderTree(folders);
    expect(tree).toHaveLength(1);
    expect(tree[0].folder.id).toBe("root");
    expect(tree[0].children.map((c) => c.id)).toEqual(["child-1", "child-2"]);
  });

  it("returns an empty children array for a childless root", () => {
    const tree = buildFolderTree([makeFolder({ id: "root" })]);
    expect(tree[0].children).toEqual([]);
  });
});

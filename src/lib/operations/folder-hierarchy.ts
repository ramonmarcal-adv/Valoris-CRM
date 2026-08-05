import type { OperationFolder } from "@/types";

/**
 * Client-side mirror of the `enforce_operation_folder_depth()` DB
 * trigger (migration 060) — lets the UI reject an invalid move/create
 * instantly instead of waiting on a round-trip error. The trigger is
 * still the source of truth; this exists for UX only.
 */
export function validateFolderParent(
  folders: OperationFolder[],
  folderId: string | null,
  parentFolderId: string | null,
): string | null {
  if (parentFolderId === null) return null;
  if (parentFolderId === folderId) {
    return "Uma pasta não pode ser sua própria pasta-mãe.";
  }

  const byId = new Map(folders.map((f) => [f.id, f]));
  const parent = byId.get(parentFolderId);
  if (parent?.parent_folder_id) {
    return "O limite é de 1 nível de subpasta — a pasta escolhida já é uma subpasta.";
  }

  if (folderId && folders.some((f) => f.parent_folder_id === folderId)) {
    return "Esta pasta já tem subpastas — não é possível movê-la para dentro de outra.";
  }

  return null;
}

/** Builds a two-level tree (root folders with their direct subfolders) for sidebar/tree rendering. */
export function buildFolderTree(folders: OperationFolder[]) {
  const roots = folders
    .filter((f) => f.parent_folder_id === null)
    .sort((a, b) => a.position - b.position);
  const childrenByParent = new Map<string, OperationFolder[]>();
  for (const folder of folders) {
    if (!folder.parent_folder_id) continue;
    const siblings = childrenByParent.get(folder.parent_folder_id) ?? [];
    siblings.push(folder);
    childrenByParent.set(folder.parent_folder_id, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.position - b.position);
  }
  return roots.map((root) => ({
    folder: root,
    children: childrenByParent.get(root.id) ?? [],
  }));
}

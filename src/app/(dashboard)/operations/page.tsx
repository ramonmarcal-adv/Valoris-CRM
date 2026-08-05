"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { GatedButton } from "@/components/ui/gated-button";
import { buildFolderTree } from "@/lib/operations/folder-hierarchy";
import type { OperationBoard, OperationFolder } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Folder, LayoutGrid, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export default function OperationsPage() {
  const t = useTranslations("Operations.rootPage");
  const supabase = createClient();
  const { accountId } = useAuth();
  const canManage = useCan("send-messages");

  const [folders, setFolders] = useState<OperationFolder[]>([]);
  const [boards, setBoards] = useState<OperationBoard[]>([]);
  const [loading, setLoading] = useState(true);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string>("none");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardFolderId, setNewBoardFolderId] = useState<string>("none");
  const [creatingBoard, setCreatingBoard] = useState(false);

  const load = useCallback(async () => {
    const [{ data: f }, { data: b }] = await Promise.all([
      supabase.from("operation_folders").select("*").is("archived_at", null).order("position"),
      supabase.from("operation_boards").select("*").is("archived_at", null).order("position"),
    ]);
    setFolders((f ?? []) as OperationFolder[]);
    setBoards((b ?? []) as OperationBoard[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name || !accountId) return;
    setCreatingFolder(true);
    const { error } = await supabase.from("operation_folders").insert({
      account_id: accountId,
      name,
      parent_folder_id: newFolderParentId === "none" ? null : newFolderParentId,
      position: folders.length,
    });
    setCreatingFolder(false);
    if (error) {
      toast.error(t("toastFailedCreateFolder"));
      return;
    }
    setNewFolderName("");
    setNewFolderOpen(false);
    toast.success(t("toastFolderCreated"));
    load();
  }

  async function handleCreateBoard() {
    const name = newBoardName.trim();
    if (!name || !accountId) return;
    setCreatingBoard(true);
    const { data, error } = await supabase
      .from("operation_boards")
      .insert({
        account_id: accountId,
        name,
        folder_id: newBoardFolderId === "none" ? null : newBoardFolderId,
        position: boards.length,
      })
      .select()
      .single();
    if (error || !data) {
      setCreatingBoard(false);
      toast.error(t("toastFailedCreateBoard"));
      return;
    }
    // Seed a single initial stage so the board isn't unusable — the
    // board settings page lets the user add/rename more afterward.
    await supabase.from("operation_board_stages").insert({
      board_id: data.id,
      name: t("defaultStageName"),
      color: "#3b82f6",
      position: 0,
      is_initial: true,
    });
    setCreatingBoard(false);
    setNewBoardName("");
    setNewBoardOpen(false);
    toast.success(t("toastBoardCreated"));
    load();
  }

  const rootlessBoards = boards.filter((b) => b.folder_id === null);
  const tree = buildFolderTree(folders);

  const foldersWithNoSubfolder = folders.filter((f) => f.parent_folder_id === null);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canManage}
            gateReason="createBoards"
            onClick={() => setNewFolderOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Folder className="mr-1 h-4 w-4" />
            {t("newFolder")}
          </GatedButton>
          <GatedButton
            canAct={canManage}
            gateReason="createBoards"
            onClick={() => setNewBoardOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("newBoard")}
          </GatedButton>
        </div>
      </div>

      {boards.length === 0 && folders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <LayoutGrid className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">{t("emptyTitle")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t("emptyDesc")}</p>
          <GatedButton
            canAct={canManage}
            gateReason="createBoards"
            onClick={() => setNewBoardOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("newBoard")}
          </GatedButton>
        </div>
      ) : (
        <>
          {tree.map(({ folder, children }) => (
            <section key={folder.id} className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Folder className="h-4 w-4 text-muted-foreground" />
                {folder.name}
              </h2>
              <BoardGrid boards={boards.filter((b) => b.folder_id === folder.id)} />
              {children.map((sub) => (
                <div key={sub.id} className="ml-6 space-y-3">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Folder className="h-3.5 w-3.5" />
                    {sub.name}
                  </h3>
                  <BoardGrid boards={boards.filter((b) => b.folder_id === sub.id)} />
                </div>
              ))}
            </section>
          ))}

          {rootlessBoards.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">{t("noFolderSection")}</h2>
              <BoardGrid boards={rootlessBoards} />
            </section>
          )}
        </>
      )}

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newFolder")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("folderName")}</Label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="border-border bg-muted text-foreground"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("parentFolder")}</Label>
              <Select value={newFolderParentId} onValueChange={(v) => setNewFolderParentId(v ?? "none")}>
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("noParentFolder")}</SelectItem>
                  {foldersWithNoSubfolder.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button
              variant="outline"
              onClick={() => setNewFolderOpen(false)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={creatingFolder || !newFolderName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creatingFolder ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New board dialog */}
      <Dialog open={newBoardOpen} onOpenChange={setNewBoardOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newBoard")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("boardName")}</Label>
              <Input
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                className="border-border bg-muted text-foreground"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBoard();
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("folder")}</Label>
              <Select value={newBoardFolderId} onValueChange={(v) => setNewBoardFolderId(v ?? "none")}>
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("noFolder")}</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button
              variant="outline"
              onClick={() => setNewBoardOpen(false)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreateBoard}
              disabled={creatingBoard || !newBoardName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creatingBoard ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoardGrid({ boards }: { boards: OperationBoard[] }) {
  if (boards.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {boards.map((board) => (
        <Link
          key={board.id}
          href={`/operations/boards/${board.id}`}
          className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 p-4 transition-colors hover:border-primary/50 hover:bg-muted"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${board.color}26` }}>
            <LayoutGrid className="h-4 w-4" style={{ color: board.color }} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{board.name}</p>
            <p className="truncate text-xs text-muted-foreground">{board.card_label_plural}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

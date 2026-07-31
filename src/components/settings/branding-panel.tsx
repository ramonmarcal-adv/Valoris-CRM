"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2, MessageSquare } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";

export const DEFAULT_BRAND_NAME = "Valoris CRM";

/**
 * Branding — the app name/logo shown in the sidebar's top-left corner
 * (sidebar.tsx). Both fields are optional; leaving them blank falls
 * back to the built-in "Valoris CRM" name and the default mark icon.
 * Writes go straight to `accounts.branding_name`/`branding_logo_url`
 * (migration 053) — same convention as DealsSettings: the
 * `accounts_update` RLS policy already restricts writes to admins+, so
 * non-admins just see a disabled, read-only preview.
 */
export function BrandingPanel() {
  const supabase = createClient();
  const { accountId, account, canEditSettings, profileLoading, refreshProfile } = useAuth();
  const t = useTranslations("Settings.branding");

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setName(account?.branding_name ?? "");
    setLogoUrl(account?.branding_logo_url ?? "");
  }, [account?.branding_name, account?.branding_logo_url]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dirty =
    name !== (account?.branding_name ?? "") || logoUrl !== (account?.branding_logo_url ?? "");

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        branding_name: name.trim() || null,
        branding_logo_url: logoUrl.trim() || null,
      })
      .eq("id", accountId);
    if (error) {
      toast.error(t("saveFailed"));
      setSaving(false);
      return;
    }
    await refreshProfile();
    setSaving(false);
    toast.success(t("saveSuccess"));
  }

  const previewName = name.trim() || DEFAULT_BRAND_NAME;
  const previewLogo = logoUrl.trim();

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Building2 className="size-4 text-primary" />
            {t("cardTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("cardDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Live preview — mirrors the sidebar's logo row exactly. */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-primary text-primary-foreground">
              {previewLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewLogo} alt="" className="h-full w-full object-cover" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
            </div>
            <span className="text-sm font-semibold text-foreground">{previewName}</span>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="branding-name" className="text-muted-foreground">
              {t("nameLabel")}
            </Label>
            <Input
              id="branding-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={DEFAULT_BRAND_NAME}
              disabled={!canEditSettings || profileLoading}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="branding-logo" className="text-muted-foreground">
              {t("logoLabel")}
            </Label>
            <Input
              id="branding-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder={t("logoPlaceholder")}
              disabled={!canEditSettings || profileLoading}
            />
            <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
          </div>

          {!canEditSettings && (
            <p className="text-xs text-muted-foreground">{t("adminOnlyHint")}</p>
          )}

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

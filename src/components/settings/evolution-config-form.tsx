'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const MASKED_KEY = '••••••••••••••••';
// Polling cadence while a QR code is on screen — short and user-
// attended (the operator is looking at the screen, phone in hand), so
// this is simpler to reason about than waiting on the CONNECTION_UPDATE
// webhook event for this one narrow window. See the plan's Area 5.
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 120_000;

type EvolutionConfigResponse =
  | { configured: false }
  | {
      configured: true;
      instance_name: string;
      api_url: string;
      is_primary: boolean;
      status: string;
      connection_state: string;
      connected: boolean;
    };

/**
 * Evolution API credentials form — the only provider that can send or
 * receive WhatsApp group messages (Meta's Cloud API can't at all). See
 * the Evolution API integration plan for the full routing rules.
 */
export function EvolutionConfigForm() {
  const t = useTranslations('Settings.whatsapp.evolution');
  const { accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [togglingPrimary, setTogglingPrimary] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);

  const [instanceName, setInstanceName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);

  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadedAccountIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
    setPolling(true);
    pollTimerRef.current = setInterval(async () => {
      if (Date.now() > pollDeadlineRef.current) {
        stopPolling();
        toast.error(t('pollTimeout'));
        return;
      }
      try {
        const res = await fetch('/api/whatsapp/evolution-config', { method: 'GET' });
        const data = (await res.json()) as EvolutionConfigResponse;
        if (data.configured && data.connected) {
          stopPolling();
          setConnected(true);
          setQrImage(null);
          toast.success(t('connectedToast'));
        }
      } catch (err) {
        console.error('[EvolutionConfigForm] poll error:', err);
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling, t]);

  // Stable identity (useCallback) — fetchConfig calls this automatically
  // whenever it finds a saved-but-disconnected config, so it must not be
  // a plain function that gets redefined (and re-triggers the effect
  // below) on every render.
  const fetchQr = useCallback(async () => {
    setQrLoading(true);
    setQrError(null);
    try {
      const res = await fetch('/api/whatsapp/evolution-config/qr', { method: 'GET' });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || t('qrError');
        setQrError(message);
        toast.error(message);
        return;
      }
      setQrImage(data.base64 || null);
      startPolling();
    } catch (err) {
      console.error('[EvolutionConfigForm] fetchQr error:', err);
      setQrError(t('qrError'));
      toast.error(t('qrError'));
    } finally {
      setQrLoading(false);
    }
  }, [startPolling, t]);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/evolution-config', { method: 'GET' });
      const data = (await res.json()) as EvolutionConfigResponse;
      if (data.configured) {
        setConfigured(true);
        setInstanceName(data.instance_name);
        setApiUrl(data.api_url);
        setApiKey(MASKED_KEY);
        setKeyEdited(false);
        setIsPrimary(data.is_primary);
        setConnected(data.connected);
        if (data.connected) {
          stopPolling();
          setQrImage(null);
          setQrError(null);
        } else {
          // Fetch a QR code automatically instead of requiring a manual
          // "Generate QR code" click on every page load — a saved-but-
          // not-yet-scanned config used to render an empty card until
          // the operator noticed and clicked the button themselves.
          // fetchQr owns its own loading/error state, so this runs in
          // the background without blocking fetchConfig's own
          // `loading` flag.
          void fetchQr();
        }
      } else {
        setConfigured(false);
        setInstanceName('');
        setApiUrl('');
        setApiKey('');
        setKeyEdited(false);
        setIsPrimary(false);
        setConnected(false);
      }
    } catch (err) {
      console.error('[EvolutionConfigForm] fetchConfig error:', err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [stopPolling, fetchQr, t]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig();
  }, [authLoading, profileLoading, accountId, fetchConfig]);

  useEffect(() => stopPolling, [stopPolling]);

  async function handleSave() {
    if (!instanceName.trim() || !apiUrl.trim()) {
      toast.error(t('requiredFields'));
      return;
    }
    if (!configured && (!apiKey.trim() || !keyEdited)) {
      toast.error(t('apiKeyRequired'));
      return;
    }
    try {
      setSaving(true);
      setSaveError(null);
      const payload: Record<string, unknown> = {
        instance_name: instanceName.trim(),
        api_url: apiUrl.trim(),
      };
      if (keyEdited && apiKey !== MASKED_KEY && apiKey.trim()) {
        payload.api_key = apiKey.trim();
      } else if (configured) {
        toast.error(t('apiKeyReenter'));
        setSaving(false);
        return;
      } else {
        payload.api_key = apiKey.trim();
      }

      const res = await fetch('/api/whatsapp/evolution-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        const message = data.error || t('saveError');
        setSaveError(message);
        toast.error(message);
        return;
      }

      if (data.webhook_registered === false) {
        toast.error(t('webhookFailed', { error: data.webhook_error ?? '' }), {
          duration: 12000,
        });
      } else {
        toast.success(t('saveSuccess'));
      }

      // fetchConfig() itself fetches a fresh QR when the reload shows
      // configured-but-not-connected — no separate fetchQr() call needed.
      await fetchConfig();
    } catch (err) {
      console.error('[EvolutionConfigForm] save error:', err);
      setSaveError(t('saveError'));
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePrimary(next: boolean) {
    setTogglingPrimary(true);
    try {
      const res = await fetch('/api/whatsapp/evolution-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_primary: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('saveError'));
        return;
      }
      setIsPrimary(next);
      toast.success(next ? t('primaryOnToast') : t('primaryOffToast'));
    } catch (err) {
      console.error('[EvolutionConfigForm] toggle primary error:', err);
      toast.error(t('saveError'));
    } finally {
      setTogglingPrimary(false);
    }
  }

  async function handleReset() {
    if (!confirm(t('resetConfirm'))) return;
    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/evolution-config', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('resetError'));
        return;
      }
      stopPolling();
      setQrImage(null);
      setQrError(null);
      setSaveError(null);
      toast.success(t('resetSuccess'));
      await fetchConfig();
    } catch (err) {
      console.error('[EvolutionConfigForm] reset error:', err);
      toast.error(t('resetError'));
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {/* ToS / ban-risk warning — always visible, not dismissible.
            This provider connects through the unofficial WhatsApp Web
            protocol, not Meta's Cloud API. */}
        <Alert className="bg-amber-950/40 border-amber-600/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <AlertTitle className="text-amber-200 mb-1">
                {t('riskBannerTitle')}
              </AlertTitle>
              <AlertDescription className="text-amber-100/80 text-sm">
                {t('riskBannerBody')}
              </AlertDescription>
            </div>
          </div>
        </Alert>

        {/* Persistent save-failure banner — a toast alone disappears
            before the operator notices, and doesn't survive a page
            reload. Most common cause: api_url isn't reachable yet
            because there's no Evolution API server running there. */}
        {saveError && (
          <Alert className="bg-red-950/40 border-red-600/40">
            <div className="flex items-start gap-3">
              <XCircle className="size-5 text-red-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <AlertTitle className="text-red-200 mb-1">{t('saveError')}</AlertTitle>
                <AlertDescription className="text-red-100/80 text-sm">
                  {saveError}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}

        {/* Connection status */}
        <Alert className="bg-card border-border">
          <div className="flex items-center gap-2">
            {connected ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-foreground mb-0">
              {connected ? t('connected') : t('disconnected')}
            </AlertTitle>
          </div>
          <AlertDescription className="text-muted-foreground">
            {connected ? t('connectedDesc') : t('disconnectedDesc')}
          </AlertDescription>
        </Alert>

        {/* Credentials */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('credentialsTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('credentialsDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('instanceName')}</Label>
              <Input
                placeholder={t('instanceNamePlaceholder')}
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('apiUrl')}</Label>
              <Input
                placeholder={t('apiUrlPlaceholder')}
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('apiKey')}</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  placeholder={t('apiKeyPlaceholder')}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyEdited(true);
                  }}
                  onFocus={() => {
                    if (apiKey === MASKED_KEY) {
                      setApiKey('');
                      setKeyEdited(true);
                    }
                  }}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {configured && !keyEdited && (
                <p className="text-xs text-muted-foreground">{t('apiKeyHidden')}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {configured && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('routingTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('routingDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{t('usePrimary')}</p>
                  <p className="text-xs text-muted-foreground">{t('usePrimaryHint')}</p>
                </div>
                <Switch
                  checked={isPrimary}
                  onCheckedChange={handleTogglePrimary}
                  disabled={togglingPrimary || !connected}
                  aria-label={t('usePrimary')}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* QR code */}
        {configured && !connected && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('qrTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('qrDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {qrError && (
                <Alert className="bg-red-950/40 border-red-600/40">
                  <div className="flex items-start gap-3">
                    <XCircle className="size-5 text-red-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <AlertTitle className="text-red-200 mb-1">{t('qrError')}</AlertTitle>
                      <AlertDescription className="text-red-100/80 text-sm">
                        {qrError}
                      </AlertDescription>
                    </div>
                  </div>
                </Alert>
              )}
              {qrImage ? (
                <div className="flex flex-col items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrImage}
                    alt={t('qrTitle')}
                    className="size-56 rounded-lg border border-border bg-white p-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    {polling ? t('waitingForScan') : t('pollTimeout')}
                  </p>
                </div>
              ) : null}
              <Button
                variant="outline"
                onClick={fetchQr}
                disabled={qrLoading}
                className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                {qrLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('qrLoading')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-4" />
                    {qrImage ? t('qrRefresh') : t('qrGenerate')}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('saveConfig')
            )}
          </Button>
          {configured && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={resetting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
            >
              {resetting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('resetting')}
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  {t('resetConfig')}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">{t('aboutTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('aboutDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{t('aboutBody1')}</p>
            <p>{t('aboutBody2')}</p>
            <div className="pt-2 border-t border-border">
              <a
                href="https://docs.evolutionfoundation.com.br"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                {t('evolutionDocs')}
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

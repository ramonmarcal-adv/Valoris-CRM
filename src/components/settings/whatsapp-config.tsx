'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';
import { MetaCloudConfigForm } from './meta-cloud-config-form';
import { EvolutionConfigForm } from './evolution-config-form';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

type Provider = 'meta_cloud' | 'evolution';

/**
 * Provider-tab shell for the WhatsApp Settings panel. Meta Cloud API
 * (the original, official integration) and Evolution API (unofficial,
 * self-hosted, the only one of the two that can send/receive WhatsApp
 * group messages) are independent `whatsapp_config` rows per account
 * (migration 048) — each tab owns its own credentials, connection
 * state, and save/reset flow via `MetaCloudConfigForm` /
 * `EvolutionConfigForm`.
 */
export function WhatsAppConfig() {
  const t = useTranslations('Settings.whatsapp');
  const [provider, setProvider] = useState<Provider>('meta_cloud');

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Tabs
        value={provider}
        onValueChange={(v) => setProvider(v as Provider)}
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="meta_cloud">{t('providerMetaTab')}</TabsTrigger>
          <TabsTrigger value="evolution">{t('providerEvolutionTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="meta_cloud">
          <MetaCloudConfigForm />
        </TabsContent>
        <TabsContent value="evolution">
          <EvolutionConfigForm />
        </TabsContent>
      </Tabs>
    </section>
  );
}

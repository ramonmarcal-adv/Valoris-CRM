# Deploy em produção — Valoris CRM + Evolution API

Guia de referência pra tirar o projeto da máquina local e colocar no ar.
Escrito em pt-BR de propósito (diferente dos outros docs em `docs/`, que
seguem o padrão em inglês do template original) porque é um guia
operacional pra este deploy específico, não documentação de API do
projeto.

## Visão geral: duas peças, dois lugares diferentes

| Peça | Onde roda | Por quê |
|---|---|---|
| CRM (Next.js) | **Vercel** | O código já é escrito pensando em Vercel especificamente — o `after()` usado nos webhooks (`src/app/api/whatsapp/webhook/route.ts`, `evolution-webhook/[configId]/route.ts`) e os comentários no código citando limites de plano da Vercel não são coincidência. Deploy = conectar o repositório, sem servidor pra gerenciar. |
| Banco de dados | **Supabase** (supabase.com) | Já é hospedado — não precisa de VPS nem de manutenção sua além de aplicar migrations. |
| Evolution API | **VPS próprio** (Hostinger, Vultr, etc.) | É a única peça com estado persistente que não roda em ambiente serverless: mantém a sessão do WhatsApp Web (Baileys) aberta o tempo todo, junto com Postgres + Redis próprios. A Vercel mataria essa conexão. |

---

## 1. Deploy do CRM na Vercel

1. Conecte o repositório GitHub do projeto a um novo projeto na Vercel (vercel.com → Add New → Project).
2. Configure as variáveis de ambiente (Project Settings → Environment Variables). Checklist baseado em `.env.local.example`:

   **Obrigatórias:**
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase → Project Settings → API.
   - `SUPABASE_SERVICE_ROLE_KEY` — mesma tela, "service_role" (nunca exponha no client).
   - `ENCRYPTION_KEY` — 64 caracteres hex. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Guarde em local seguro fora do Vercel também** — se perder essa chave, todo access_token/api_key salvo (Meta e Evolution) fica ilegível e precisa ser reconfigurado do zero.
   - `META_APP_SECRET` — só necessário se for usar o provedor Meta Cloud API também; se o plano é só Evolution API, ainda assim o código atual exige essa variável pro webhook da Meta não rejeitar tudo (deixe qualquer valor não-vazio se não for usar Meta).

   **Recomendadas:**
   - `NEXT_PUBLIC_SITE_URL` — URL pública final (ex: `https://crm.seudominio.com.br`).
   - `NEXT_PUBLIC_APP_LOCALE=pt`.

3. Deploy. A partir daqui, todo `git push` na branch de produção builda e publica sozinho — não tem passo manual nenhum pro CRM em si.

**Limitação conhecida a ter em mente**: o rate limiting (`src/lib/rate-limit.ts`) é em memória, por processo — funciona bem numa VPS de instância única, mas em ambiente serverless com múltiplas instâncias simultâneas (Vercel) cada instância tem seu próprio contador, então o limite real acaba sendo mais alto do que o configurado. Não é um bug introduzido agora, é uma característica conhecida do projeto (comentário no próprio arquivo já cita isso) — só documentando pra você não assumir que está mais protegido do que está.

---

## 2. Migrations do Supabase

O projeto usa arquivos SQL simples em `supabase/migrations/`, sem CI configurado ainda pra aplicá-los automaticamente. Duas formas de aplicar em produção:

- **Manual (mais simples pra começar)**: Supabase Dashboard → SQL Editor → colar o conteúdo de cada arquivo `NNN_*.sql` em ordem numérica e rodar. As migrations mais recentes que interessam pro Evolution API são `048_evolution_api_provider.sql` e `049_evolution_group_support.sql`.
- **Via Supabase CLI**: `supabase link --project-ref <seu-project-ref>` uma vez, depois `supabase db push` a cada nova migration. Requer o CLI instalado e autenticado (`supabase login`).
- **Automatizado**: veja `.github/workflows/supabase-migrations.yml` (seção 5 abaixo) — opcional, desativado até você configurar os secrets.

Confirme que todas as migrations até `049` foram aplicadas antes do primeiro deploy — sem elas a tela de Configurações → Evolution API não vai funcionar (as colunas `api_type`/`instance_name`/etc. não existem ainda).

---

## 3. Subir a Evolution API

Duas rotas — escolha uma:

### Caminho A — Hostinger, app "Evolution API" (1 clique, recomendado)

O link que você mandou (`hostinger.com/br/applications/evolution-api`) é uma boa escolha: datacenter em São Paulo, já vem com Postgres + Redis prontos, atualização em 1 clique pelo painel Docker deles.

1. Contrate um VPS **KVM 2 (2 vCPU / 8GB RAM)** — não o KVM 1. Evolution API + Postgres + Redis + overhead do Docker rodando juntos em 4GB fica no limite mesmo com pouco uso; 8GB dá folga real pra vários grupos.
2. Na contratação, **selecione explicitamente São Paulo** como região — se não selecionar, pode cair em outro datacenter (EUA/Europa) por padrão.
3. Instale a app "Evolution API" pelo marketplace de aplicações da Hostinger.
4. Anote a URL pública que a Hostinger te dá pro serviço (geralmente `https://<algo>.hostinger.com` ou um IP — confirme se vem com HTTPS; se não vier, configure um domínio próprio apontando pro VPS e habilite HTTPS pelo painel deles antes de usar em produção, porque a API key trafega no header de toda requisição).
5. Gere/anote a API key configurada na instalação — é o valor que vai entrar no campo "API Key" da tela de Configurações do CRM.

### Caminho B — VPS manual (Vultr, DigitalOcean, Contabo, Hostinger sem o app pronto)

Use o `docker-compose.yml` de referência em `deploy/evolution-api/` deste repositório:

```bash
# No VPS, com Docker + Docker Compose instalados:
git clone <seu-fork-ou-copie-a-pasta-deploy/evolution-api>
cd evolution-api
cp .env.example .env
# edite .env: AUTHENTICATION_API_KEY, POSTGRES_PASSWORD, EVOLUTION_DOMAIN
docker compose up -d
```

Pré-requisito: um domínio/subdomínio (ex: `evolution.seudominio.com.br`) com registro A já apontando pro IP do VPS **antes** de subir o stack — o Caddy incluído no compose pede o certificado TLS automaticamente no primeiro boot e precisa que o domínio já resolva.

Recomendação de provedor se for por esse caminho: **Vultr, região São Paulo** — confirma datacenter no Brasil (baixa latência), plano a partir de ~US$5-6/mês, cobrança por hora. Contabo é mais barato mas não tem datacenter confirmado no Brasil (latência maior). DigitalOcean não tem datacenter no Brasil.

### Depois de qualquer um dos dois caminhos

No CRM, abra **Configurações → WhatsApp → aba Evolution API** e preencha:
- **Nome da instância**: qualquer identificador (ex: `valoris-crm`).
- **URL do servidor**: a URL HTTPS de onde a Evolution API está respondendo.
- **API Key**: a chave gerada/configurada acima.

Clique em Salvar. Se a Evolution API estiver realmente alcançável, o QR code aparece automaticamente na tela (correção feita nesta sessão — antes era preciso clicar manualmente em "Gerar QR code" mesmo com tudo certo). Escaneie com o WhatsApp que vai usar pros grupos.

---

## 4. Fluxo de atualização

| Peça | Como atualizar |
|---|---|
| CRM (Next.js) | `git push` na branch de produção → Vercel builda e publica sozinho. |
| Migration nova no Supabase | Rodar manualmente no SQL Editor (ou `supabase db push`) — não é automático ainda, a não ser que você ative o workflow opcional (seção 5). |
| Evolution API (Hostinger) | Botão de update no painel Docker da Hostinger. |
| Evolution API (self-managed) | No VPS: `cd evolution-api && docker compose pull && docker compose up -d`. |

---

## 5. (Opcional) Automatizar as migrations do Supabase

`.github/workflows/supabase-migrations.yml` roda `supabase db push` sozinho a cada merge em `main` que mexa em `supabase/migrations/**`. Fica inativo até você configurar, no GitHub (Settings → Secrets and variables → Actions), dois secrets:

- `SUPABASE_ACCESS_TOKEN` — gerado em supabase.com/dashboard/account/tokens.
- `SUPABASE_PROJECT_REF` — o ref do projeto (aparece na URL do dashboard ou em Project Settings → General).

Sem esses dois secrets configurados, o workflow falha de forma visível no GitHub Actions (não aplica nada silenciosamente errado) — configure só quando quiser mesmo automatizar.

---

## Aviso que já está na UI, repetindo aqui

A Evolution API é não-oficial (protocolo WhatsApp Web/Baileys). Usar isso com um número de WhatsApp Business viola os Termos de Serviço da Meta e tem risco real de banimento do número, sem recurso via suporte da Meta. Considere isso ao decidir qual número conectar.

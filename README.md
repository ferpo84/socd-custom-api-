# SOCD Custom API (VTEX IO)

App VTEX IO (Node) com rotas utilitárias para a SOCD. Inclui endpoints de saúde, versão e utilitários para consumir o **XML de produtos** e retornar o **produto mais barato** por termo.

> **Importante:** não coloque chaves/segredos no repositório. Use as **App Settings** no Admin da VTEX ou segredos do workspace para configurar tokens.

---

## 📁 Estrutura

```
socd-custom-api/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── node/
│   ├── index.ts
│   ├── package.json
│   ├── service.json
├── .gitignore
├── manifest.json
├── README.md
```

## ⚙️ Configurações (App Settings)

`manifest.json` expõe o schema abaixo (configure no Admin VTEX → Apps → app settings):

- `xmlFeedUrls` (array): URLs do feed XML com produtos da SOCD. Por padrão, já vem com:
  - `https://xpicer.nyc3.cdn.digitaloceanspaces.com/socd_shippingdiscount.xml`
  - `https://xpicer.nyc3.digitaloceanspaces.com/socd_shippingdiscount.xml`
- `enableXmlCache` (boolean): ativa cache do XML em memória (padrão: `true`).
- `xmlCacheSeconds` (number): TTL do cache (padrão: `300` segundos).
- `allowedOrigins` (array): lista de origens permitidas para CORS. Se vazio, libera para todas as origens que chamarem o endpoint.
- `octadesk` (opcional): dados para futura integração de tickets via API:
  - `apiBase` (default: `https://public-api.octadesk.services`)
  - `apiKey` (`x-api-key`)
  - `agentEmail` (`octa-agent-email`)

> Referência Octadesk Tickets: https://developers.octadesk.com/reference/tickets

## 🔌 Endpoints

Todos os endpoints seguem o padrão `/_v/...` recomendado em VTEX IO.

### `GET /_v/health`
Retorna `{ ok: true }` para health checks.

### `GET /_v/ping`
Retorna `pong` (teste simples).

### `GET /_v/socd/version`
Retorna a versão publicada do app.

### `GET /_v/socd/xml-to-json` (restrito)
Baixa o XML (da primeira URL disponível em `xmlFeedUrls`) e retorna JSON parseado. Útil para **debug**.

### `GET /_v/socd/products/cheapest?q=<termo>`
Busca no XML e retorna **o produto mais barato** cujo **título contém** o termo informado (case-insensitive).
Exemplo:
```
/_v/socd/products/cheapest?q=prensa
```
**Resposta (exemplo):**
```json
{
  "query": "prensa",
  "totalMatches": 5,
  "cheapest": {
    "id": "123",
    "title": "Prensa Mecolour XYZ",
    "link": "https://www.socd.com.br/...",
    "price": 999.9,
    "inStock": true,
    "brand": "Mecolour",
    "image": "https://.../imagem.jpg",
    "category": "Máquinas > Prensas"
  }
```

> O parser tenta lidar com estruturas comuns de feeds (Google Merchant/RSS). Se o seu XML tiver estrutura diferente, basta ajustar a função `mapItemToProduct` em `node/index.ts`.

## 🚀 Como publicar

1. **Login no Toolbelt** (local):
   ```bash
   vtex login <account>
   vtex use <workspace>
   vtex whoami
   ```

2. **Publicar**:
   ```bash
   vtex link     # para testar
   vtex publish  # para publicar a versão
   vtex install socd.custom-api@0.1.0
   ```

3. **Configurar o App** (Admin VTEX → Apps → App Settings do `socd.custom-api`):
   - Preencha `xmlFeedUrls`, `allowedOrigins` e (opcional) bloco `octadesk`.

## 🧪 Testes rápidos (curl)

```bash
curl -s https://{account}.myvtex.com/_v/health
curl -s https://{account}.myvtex.com/_v/ping
curl -s https://{account}.myvtex.com/_v/socd/version
curl -s "https://{account}.myvtex.com/_v/socd/products/cheapest?q=caneca"
```

## 🛡️ Boas práticas de segurança

- **Nunca** comitar chaves (VTEX, Octadesk, etc.).
- Se publicar este repositório de forma pública, remova quaisquer dados sensíveis do README.
- Revise **CORS** (`allowedOrigins`) para liberar apenas os domínios que de fato vão consumir os endpoints.

## 🧭 Roadmap curto (sugestão)

- [ ] Endpoint `/tickets/create` integrando com **Octadesk Tickets API** (headers `x-api-key` e `octa-agent-email`).
- [ ] Enriquecer a busca (price/stock/categoria) com fallback para **Intelligent Search** da VTEX quando não achar no XML.
- [ ] Cache distribuído (ex.: Redis) caso necessário.

---

### 📍 Dados institucionais (SOCD)

- Loja física: **R. Bresser, 736 - Brás, São Paulo - SP**
- WhatsApp Vendas: **(11) 94031-5877**
- Instagram: **https://www.instagram.com/socdsuprimentos/**
- Site: **https://www.socd.com.br**

> *Este app foi gerado como base para acelerar integrações do projeto SOCD.*
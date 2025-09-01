import { Service, method, ParamsContext, RecorderState, IOClients, InstanceOptions, ExternalClient, LRUCache, Apps } from '@vtex/api'
import { XMLParser } from 'fast-xml-parser'

type Ctx = ParamsContext & {
  vtex: ParamsContext['vtex'] & { logger?: any }
  clients: Clients
}

const XML_CACHE_KEY = 'SOCD_XML_CACHE'

// --------- Clients ---------
export class HttpClient extends ExternalClient {
  constructor(ctx: any, opts?: InstanceOptions) {
    super('', ctx, { ...opts })
  }

  public async getUrl(url: string): Promise<string> {
    return this.http.get<string>(url, { metric: 'external-get' })
  }
}

export class Clients extends IOClients {
  public get httpClient() { return this.getOrSet('httpClient', HttpClient) }
  public get apps() { return this.getOrSet('apps', Apps) }
}

const ONE_MINUTE_MS = 60 * 1000
const cache = new LRUCache<string, any>({ max: 2, maxAge: 5 * ONE_MINUTE_MS })

const clientsConfig = {
  implementation: Clients,
  options: {
    httpClient: {
      retries: 2,
      timeout: 4000,
    },
    // global cache
    '': { memoryCache: cache },
  }
}

// --------- Utils ---------
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  parseAttributeValue: true,
})

function normalizeText(t?: string): string {
  return (t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

type AppSettings = {
  xmlFeedUrls?: string[]
  enableXmlCache?: boolean
  xmlCacheSeconds?: number
  allowedOrigins?: string[]
  octadesk?: {
    apiBase?: string
    apiKey?: string
    agentEmail?: string
  }
}

async function getSettings(ctx: Ctx): Promise<AppSettings> {
  const appId = process.env.VTEX_APP_ID || `${ctx.vtex.vendor}.${ctx.vtex.appName}`
  try {
    return await ctx.clients.apps.getAppSettings(appId)
  } catch {
    return {}
  }
}.${ctx.vtex.appName}`
  const apps = (ctx as any).clients?.apps || (ctx as any).clients?.Apps
  if (apps && apps.getAppSettings) {
    try {
      return await apps.getAppSettings(appId)
    } catch {
      // ignore
    }
  }
  return {}
}

// Tries to parse common XML feed structures (Google Merchant-like, RSS-like)
function extractItemsFromXml(xmlObj: any): any[] {
  if (!xmlObj) return []

  // Google Merchant style: <rss><channel><item>...</item></channel></rss>
  const rssItems = xmlObj?.rss?.channel?.item
  if (Array.isArray(rssItems)) return rssItems
  if (rssItems) return [rssItems]

  // Generic: <items><item>...</item></items>
  const items = xmlObj?.items?.item
  if (Array.isArray(items)) return items
  if (items) return [items]

  // Alternative: <products><product>...</product></products>
  const products = xmlObj?.products?.product
  if (Array.isArray(products)) return products
  if (products) return [products]

  // Fallback: try to find first array in tree
  for (const k of Object.keys(xmlObj)) {
    const v = xmlObj[k]
    if (Array.isArray(v)) return v
    if (typeof v === 'object' && v) {
      const nested = extractItemsFromXml(v)
      if (nested.length) return nested
    }
  }
  return []
}

function mapItemToProduct(item: any) {
  // Attempt to read common tags
  const title = item?.title || item?.['g:title'] || item?.name || item?.product_title
  const link = item?.link || item?.['g:link'] || item?.url || item?.product_link
  const priceRaw = item?.price || item?.['g:price'] || item?.sale_price || item?.['g:sale_price']
  const availability = item?.availability || item?.['g:availability'] || item?.stock_status || item?.in_stock
  const gtin = item?.gtin || item?.['g:gtin']
  const brand = item?.brand || item?.['g:brand']
  const image = item?.image_link || item?.['g:image_link'] || item?.image || item?.image_url
  const productType = item?.['g:product_type'] || item?.product_type || item?.category
  const id = item?.id || item?.['g:id'] || item?.sku

  // Parse price like "123.45 BRL" or "BRL 123.45"
  let price = NaN as number
  if (typeof priceRaw === 'string') {
    const m = priceRaw.match(/(\d+[.,]?\d*)/)
    if (m) price = parseFloat(m[1].replace(',', '.'))
  } else if (typeof priceRaw === 'number') {
    price = priceRaw
  }

  const inStock = String(availability || '').toLowerCase().includes('in stock') ||
                  String(availability || '').toLowerCase().includes('instock') ||
                  String(availability || '').toLowerCase().includes('em estoque') ||
                  String(availability || '').toLowerCase().includes('available') ||
                  String(availability || '').toLowerCase() === 'true'

  return { id, title, link, price, inStock, brand, image, productType, raw: item }
}

// --------- Handlers ---------
const health = method({
  GET: async (ctx: Ctx) => {
    ctx.status = 200
    ctx.body = { ok: true, app: 'socd-custom-api' }
  }
})

const ping = method({
  GET: async (ctx: Ctx) => {
    ctx.status = 200
    ctx.body = 'pong'
  }
})

const version = method({
  GET: async (ctx: Ctx) => {
    const version = process.env.VTEX_APP_VERSION || '0.1.0'
    ctx.status = 200
    ctx.body = { version }
  }
})

const xmlToJson = method({
  GET: async (ctx: Ctx) => {
    const settings = await getSettings(ctx)
    const urls = settings.xmlFeedUrls || []
    if (!urls.length) {
      ctx.status = 400
      ctx.body = { error: 'Nenhuma URL de XML configurada (settings.xmlFeedUrls)' }
      return
    }

    const useCache = settings.enableXmlCache !== false
    const ttlMs = (settings.xmlCacheSeconds ?? 300) * 1000

    let xmlText: string | undefined
    if (useCache) {
      const cached = cache.get(XML_CACHE_KEY)
      if (cached && (Date.now() - cached.ts) < ttlMs) {
        xmlText = cached.data
      }
    }

    if (!xmlText) {
      let lastErr: any
      for (const url of urls) {
        try {
          xmlText = await ctx.clients.httpClient.getUrl(url)
          break
        } catch (err) {
          lastErr = err
        }
      }
      if (!xmlText) {
        ctx.status = 502
        ctx.body = { error: 'Falha ao baixar XML em todas as URLs configuradas.' }
        return
      }
      if (useCache) {
        cache.set(XML_CACHE_KEY, { ts: Date.now(), data: xmlText })
      }
    }

    const json = parser.parse(xmlText)
    ctx.status = 200
    ctx.body = json
  }
})

const cheapestProduct = method({
  GET: async (ctx: Ctx) => {
    const q = String(ctx.query?.q || ctx.query?.query || '').trim()
    if (!q) {
      ctx.status = 400
      ctx.body = { error: "Parâmetro obrigatório: q (query do produto)" }
      return
    }

    // Reuse xmlToJson logic
    const settings = await getSettings(ctx)
    const urls = settings.xmlFeedUrls || []
    const useCache = settings.enableXmlCache !== false
    const ttlMs = (settings.xmlCacheSeconds ?? 300) * 1000

    let xmlText: string | undefined
    if (useCache) {
      const cached = cache.get(XML_CACHE_KEY)
      if (cached && (Date.now() - cached.ts) < ttlMs) {
        xmlText = cached.data
      }
    }

    if (!xmlText) {
      let lastErr: any
      for (const url of urls) {
        try {
          xmlText = await ctx.clients.httpClient.getUrl(url)
          break
        } catch (err) {
          lastErr = err
        }
      }
      if (!xmlText) {
        ctx.status = 502
        ctx.body = { error: 'Falha ao baixar XML em todas as URLs configuradas.' }
        return
      }
      if (useCache) {
        cache.set(XML_CACHE_KEY, { ts: Date.now(), data: xmlText })
      }
    }

    const json = parser.parse(xmlText)
    const items = extractItemsFromXml(json)
    const normalizedQ = normalizeText(q)

    const mapped = items.map(mapItemToProduct).filter(p => p && p.title)
    const filtered = mapped.filter(p => normalizeText(p.title).includes(normalizedQ))

    if (!filtered.length) {
      ctx.status = 404
      ctx.body = { error: "Nenhum produto encontrado para a busca.", query: q }
      return
    }

    // Escolher o mais barato disponível (se empatar, pega o primeiro)
    const sorted = filtered
      .filter(p => Number.isFinite(p.price))
      .sort((a, b) => (a.price as number) - (b.price as number))

    const cheapest = sorted[0] || filtered[0]

    ctx.status = 200
    ctx.body = {
      query: q,
      totalMatches: filtered.length,
      cheapest: {
        id: cheapest.id,
        title: cheapest.title,
        link: cheapest.link,
        price: cheapest.price,
        inStock: cheapest.inStock,
        brand: cheapest.brand,
        image: cheapest.image,
        category: cheapest.productType
      }
    }
  }
})

// --------- CORS (optional) ---------
async function applyCors(ctx: Ctx) {
  const settings = await getSettings(ctx)
  const origins = settings.allowedOrigins || []
  const origin = String(ctx.request.headers.origin || '')
  if (!origin) return

  if (origins.length === 0 || origins.includes(origin)) {
    ctx.set('Access-Control-Allow-Origin', origin)
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
}

export default new Service<Ctx, RecorderState>({
  clients: clientsConfig,
  routes: {
    health: {
      options: async (ctx: Ctx) => { await applyCors(ctx); ctx.status = 204 },
      GET: health.GET,
    },
    ping: {
      options: async (ctx: Ctx) => { await applyCors(ctx); ctx.status = 204 },
      GET: ping.GET,
    },
    version: {
      options: async (ctx: Ctx) => { await applyCors(ctx); ctx.status = 204 },
      GET: version.GET,
    },
    xmlToJson: {
      options: async (ctx: Ctx) => { await applyCors(ctx); ctx.status = 204 },
      GET: xmlToJson.GET,
    },
    cheapestProduct: {
      options: async (ctx: Ctx) => { await applyCors(ctx); ctx.status = 204 },
      GET: cheapestProduct.GET,
    },
  },
})

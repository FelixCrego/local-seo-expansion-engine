module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const normalized = normalizePayload(payload);
    if (!normalized.website || !normalized.primaryService || !normalized.primaryMarket) {
      return res.status(400).json({ error: 'website, primaryService, and primaryMarket are required.' });
    }

    const crawl = await crawlSite(normalized);
    const engineResult = buildEngineResult(normalized, crawl);
    if (normalized.competitors.length) {
      const competitorItems = await crawlCompetitors(normalized.competitors, normalized);
      engineResult.competitorComparison = {
        items: competitorItems,
        summary: summarizeCompetitors(competitorItems, engineResult)
      };
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        mode: 'heuristic',
        ...engineResult
      });
    }

    try {
      const aiAnalysis = await generateAiRead(normalized, crawl, engineResult);
      return res.status(200).json({
        mode: 'ai',
        ...engineResult,
        aiAnalysis
      });
    } catch (error) {
      return res.status(200).json({
        mode: 'heuristic',
        ...engineResult,
        aiAnalysis: {
          blocks: [
            engineResult.summary,
            'The AI layer was unavailable, so the engine fell back to the structural crawl and local heuristic model.',
            error.message.slice(0, 180)
          ]
        }
      });
    }
  } catch (error) {
    return res.status(200).json({
      mode: 'heuristic',
      scores: { coverage: 0, quality: 0, linking: 0, readiness: 0 },
      headline: 'The engine could not complete the scan.',
      summary: 'The request failed before the local footprint could be analyzed.',
      crawl: {
        statusLabel: 'Failed',
        pagesAnalyzed: 0,
        localPages: 0,
        coveredMarkets: 0,
        totalMarkets: 0,
        note: error.message.slice(0, 180)
      },
      priorities: [],
      gaps: [],
      inventory: [],
      callouts: [],
      linkOpportunities: [],
      blueprints: [],
      contentBriefs: [],
      aiAnalysis: { blocks: ['The scan failed before a strategy readout could be generated.'] }
    });
  }
};

function normalizePayload(payload) {
  return {
    website: normalizeUrl(payload.website),
    primaryService: cleanString(payload.primaryService),
    primaryMarket: cleanString(payload.primaryMarket),
    targetMarkets: normalizeList(payload.targetMarkets),
    targetServices: normalizeList(payload.targetServices),
    businessType: cleanString(payload.businessType),
    notes: cleanString(payload.notes),
    competitors: normalizeList(payload.competitors).map(normalizeUrl).slice(0, 2)
  };
}

function normalizeUrl(input) {
  const value = cleanString(input);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }
  return cleanString(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanString(value) {
  return String(value || '').trim();
}

async function crawlSite(input) {
  const root = new URL(input.website);
  const rootUrl = root.toString();
  const pageQueue = [];
  const seen = new Set();
  const pages = [];

  const homepage = await fetchPage(rootUrl);
  if (!homepage.ok) {
    throw new Error(homepage.error || 'Could not fetch the submitted website.');
  }

  pageQueue.push(rootUrl);
  seen.add(rootUrl);

  const sitemapUrls = await fetchSitemapUrls(root);
  sitemapUrls.forEach((url) => {
    if (sameOrigin(root, url) && !seen.has(url)) {
      seen.add(url);
      pageQueue.push(url);
    }
  });

  extractInternalLinks(homepage.html, root).forEach((url) => {
    if (!seen.has(url)) {
      seen.add(url);
      pageQueue.push(url);
    }
  });

  const crawlTargets = pageQueue.slice(0, 28);
  for (const url of crawlTargets) {
    const page = url === rootUrl ? homepage : await fetchPage(url);
    if (page.ok) {
      pages.push(extractPageSignals(page.url, page.html, root));
    }
  }

  return {
    root: rootUrl,
    pages,
    discovered: crawlTargets.length
  };
}

async function crawlCompetitors(urls, input) {
  const items = [];
  for (const website of urls) {
    try {
      const crawl = await crawlSite({ website });
      const pageMap = crawl.pages.map((page) => classifyPage(page, uniqueNormalized([input.primaryMarket, ...input.targetMarkets]), uniqueNormalized([input.primaryService, ...input.targetServices])));
      const marketCoverage = uniqueNormalized(pageMap.map((page) => page.market).filter(Boolean)).length;
      const servicePairs = new Set(pageMap.filter((page) => page.pairKey).map((page) => page.pairKey)).size;
      items.push({
        website,
        label: safeHost(website),
        pagesAnalyzed: crawl.pages.length,
        marketCoverage,
        servicePairs,
        readout: competitorReadout(crawl.pages.length, marketCoverage, servicePairs)
      });
    } catch (error) {
      items.push({
        website,
        label: safeHost(website),
        pagesAnalyzed: 0,
        marketCoverage: 0,
        servicePairs: 0,
        readout: `The competitor site could not be crawled cleanly: ${error.message.slice(0, 120)}`
      });
    }
  }
  return items;
}

async function fetchSitemapUrls(root) {
  const candidates = [
    new URL('/sitemap.xml', root).toString(),
    new URL('/sitemap_index.xml', root).toString()
  ];

  for (const sitemapUrl of candidates) {
    try {
      const response = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'LocalSEOExpansionEngine/1.0 (+https://local-seo-expansion-engine.vercel.app)' }
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const locs = [];
      const regex = /<loc>([\s\S]*?)<\/loc>/gi;
      let match;
      while ((match = regex.exec(xml)) !== null) {
        locs.push(cleanString(match[1]));
      }
      if (locs.length) return locs.slice(0, 40);
    } catch {
      continue;
    }
  }

  return [];
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'LocalSEOExpansionEngine/1.0 (+https://local-seo-expansion-engine.vercel.app)' }
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ok: false, error: 'Non-HTML content' };
    }

    return {
      ok: true,
      url: response.url || url,
      html: await response.text()
    };
  } catch (error) {
    return { ok: false, error: error.message.slice(0, 180) };
  }
}

function sameOrigin(root, url) {
  try {
    return new URL(url).origin === root.origin;
  } catch {
    return false;
  }
}

function extractInternalLinks(html, root) {
  const links = new Set();
  const regex = /<a[^>]+href=["']([\s\S]*?)["'][^>]*>/gi;
  let match;

  while ((match = regex.exec(html || '')) !== null) {
    const href = cleanString(match[1]);
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    try {
      const absolute = new URL(href, root).toString();
      if (sameOrigin(root, absolute)) links.add(stripHash(absolute));
    } catch {
      continue;
    }
  }

  return Array.from(links).slice(0, 40);
}

function stripHash(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function extractPageSignals(url, html, root) {
  const path = (() => {
    try {
      return new URL(url).pathname || '/';
    } catch {
      return '/';
    }
  })();

  const cleanHtml = html || '';
  const text = stripTags(cleanHtml).replace(/\s+/g, ' ').trim();
  const title = cleanText(matchOne(cleanHtml, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const metaDescription = cleanText(matchMeta(cleanHtml, 'description'));
  const h1s = matchAll(cleanHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(cleanText).filter(Boolean).slice(0, 3);
  const h2s = matchAll(cleanHtml, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map(cleanText).filter(Boolean).slice(0, 8);
  const links = extractInternalLinks(cleanHtml, root);
  const buttons = matchAll(cleanHtml, /<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/gi)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 20);

  return {
    url,
    path,
    title,
    metaDescription,
    h1s,
    h2s,
    text,
    wordCount: text ? text.split(/\s+/).length : 0,
    forms: (cleanHtml.match(/<form\b/gi) || []).length,
    internalLinkCount: links.length,
    internalLinks: links,
    phoneVisible: /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/.test(text),
    emailVisible: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text),
    faqSignals: countKeywordHits(text, ['faq', 'frequently asked', 'questions']),
    proofSignals: countKeywordHits(text, ['testimonial', 'review', 'success story', 'case study', 'trusted', 'years of experience']),
    localSignals: countKeywordHits(text, ['county', 'city', 'service area', 'local', 'near me']),
    buttons,
    hasSchemaSignal: /application\/ld\+json/i.test(cleanHtml),
    looksIndexable: !/noindex/i.test(cleanHtml)
  };
}

function buildEngineResult(input, crawl) {
  const markets = uniqueNormalized([input.primaryMarket, ...input.targetMarkets]);
  const services = uniqueNormalized([input.primaryService, ...input.targetServices]);
  const pageMap = crawl.pages.map((page) => classifyPage(page, markets, services));

  const localPages = pageMap.filter((page) => page.market || /county|city|service-area|location|area|market/i.test(page.pageType));
  const coveredMarkets = uniqueNormalized(localPages.map((page) => page.market).filter(Boolean));
  const coveredServices = uniqueNormalized(pageMap.map((page) => page.service).filter(Boolean));

  const gaps = buildGaps(markets, services, pageMap);
  const inventory = buildInventory(pageMap);
  const callouts = buildCallouts(pageMap);
  const linkOpportunities = buildLinkOpportunities(pageMap, markets, services);
  const blueprints = buildBlueprints(gaps, pageMap, input);
  const contentBriefs = buildContentBriefs(blueprints, input);
  const clusterMap = buildClusterMap(markets, services, pageMap);

  const scores = {
    coverage: scoreCoverage(markets, services, pageMap),
    quality: scoreQuality(pageMap),
    linking: scoreLinking(pageMap),
    readiness: 0
  };
  scores.readiness = clamp(Math.round((scores.coverage * 0.35) + (scores.quality * 0.35) + (scores.linking * 0.3)));

  const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0];
  const priorities = buildPriorities(scores, gaps, pageMap, weakest);
  const headline = buildHeadline(scores, weakest);
  const summary = buildSummary(scores, gaps, crawl.pages.length, coveredMarkets.length, markets.length);

  return {
    scores,
    headline,
    summary,
    crawl: {
      statusLabel: 'Complete',
      pagesAnalyzed: crawl.pages.length,
      localPages: localPages.length,
      coveredMarkets: coveredMarkets.length,
      totalMarkets: markets.length,
      note: `The engine crawled ${crawl.pages.length} HTML page${crawl.pages.length === 1 ? '' : 's'} and checked market coverage, service-match pages, metadata, proof, forms, and internal-link pathways.`
    },
    priorities,
    gaps,
    inventory,
    callouts,
    clusterMap,
    linkOpportunities,
    blueprints,
    contentBriefs,
    competitorComparison: { items: [], summary: '' },
    aiAnalysis: {
      blocks: buildFallbackBlocks(scores, gaps, pageMap, input)
    }
  };
}

function classifyPage(page, markets, services) {
  const market = bestMatch(page, markets);
  const service = bestMatch(page, services);
  const lowerPath = page.path.toLowerCase();
  const pageType = inferPageType(lowerPath, market, service, page);
  const qualityScore = scorePage(page, Boolean(market), Boolean(service));

  return {
    ...page,
    market,
    service,
    pageType,
    qualityScore,
    pairKey: market && service ? `${market}__${service}` : '',
    summary: summarizePage(page, pageType, market, service, qualityScore)
  };
}

function bestMatch(page, terms) {
  const haystack = `${page.path} ${page.title} ${page.metaDescription} ${page.h1s.join(' ')} ${page.h2s.join(' ')}`.toLowerCase();
  let best = '';
  let bestLength = 0;
  for (const term of terms) {
    const token = term.toLowerCase();
    if (token && haystack.includes(token) && token.length > bestLength) {
      best = term;
      bestLength = token.length;
    }
  }
  return best;
}

function inferPageType(path, market, service, page) {
  if (market && service) return 'Market + service page';
  if (market && /county|city|area|market|service-areas|locations/.test(path)) return 'Market page';
  if (service && /service|foreclosure|probate|repair|rental|inherited|divorce|vacant|urgent/.test(path)) return 'Service page';
  if (/service-areas|locations|markets|areas/.test(path)) return 'Hub page';
  if (page.h1s.length && market) return 'Market page';
  if (page.h1s.length && service) return 'Service page';
  return 'General page';
}

function summarizePage(page, pageType, market, service, qualityScore) {
  const bits = [pageType];
  if (market) bits.push(`market: ${market}`);
  if (service) bits.push(`service: ${service}`);
  bits.push(`${qualityScore} quality`);
  return bits.join(' | ');
}

function buildGaps(markets, services, pageMap) {
  const pairSet = new Set(pageMap.filter((page) => page.pairKey).map((page) => page.pairKey));
  const items = [];

  for (const market of markets) {
    const marketPage = pageMap.find((page) => page.market === market && page.pageType !== 'General page');
    if (!marketPage) {
      items.push({
        title: `Build a dedicated ${market} page`,
        detail: `The crawl did not find a strong market page dedicated to ${market}. That limits how well the site can establish local relevance there.`,
        market,
        level: 'critical',
        priority: 'Build market hub first'
      });
    }

    for (const service of services) {
      const key = `${market}__${service}`;
      if (!pairSet.has(key)) {
        items.push({
          title: `Add ${service} coverage for ${market}`,
          detail: `The scan did not find a page clearly pairing ${service} with ${market}. That leaves a coverage gap for one of the most natural local search combinations.`,
          market,
          service,
          level: market === markets[0] || service === services[0] ? 'critical' : 'high',
          priority: 'Create paired local page'
        });
      }
    }
  }

  return items.slice(0, 10);
}

function buildInventory(pageMap) {
  return [...pageMap]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 12)
    .map((page) => ({
      title: page.title || page.h1s[0] || page.url,
      url: page.url,
      pageType: page.pageType,
      market: page.market,
      service: page.service,
      qualityScore: page.qualityScore,
      summary: page.summary
    }));
}

function buildCallouts(pageMap) {
  const items = [];
  const lowMeta = pageMap.filter((page) => (page.market || page.service) && (!page.title || !page.metaDescription)).slice(0, 2);
  const lowDepth = pageMap.filter((page) => (page.market || page.service) && page.wordCount < 250).slice(0, 2);
  const lowTrust = pageMap.filter((page) => (page.market || page.service) && page.proofSignals === 0).slice(0, 2);

  lowMeta.forEach((page) => {
    items.push({
      title: 'Weak metadata on an important local page',
      detail: 'This page is missing a stronger title tag or meta description, which makes it harder to clarify local intent and earn clicks.',
      page: trimTitle(page.title || page.url),
      severity: 'critical'
    });
  });

  lowDepth.forEach((page) => {
    items.push({
      title: 'Local page depth is likely too thin',
      detail: `This page only showed about ${page.wordCount} words during the crawl. It likely needs more local context, proof, and FAQ depth to compete harder.`,
      page: trimTitle(page.title || page.url),
      severity: 'high'
    });
  });

  lowTrust.forEach((page) => {
    items.push({
      title: 'Proof is missing near a local intent page',
      detail: 'The engine did not detect obvious testimonial, review, or case-study language on this page. That weakens trust at a key decision point.',
      page: trimTitle(page.title || page.url),
      severity: 'medium'
    });
  });

  const deduped = dedupeBy(items, (item) => `${item.title}:${item.page}`);
  if (deduped.length) return deduped.slice(0, 6);

  const lowestPages = [...pageMap]
    .filter((page) => page.market || page.service || page.pageType !== 'General page')
    .sort((a, b) => a.qualityScore - b.qualityScore)
    .slice(0, 3);

  return lowestPages.map((page) => ({
    title: 'Page worth tightening before expansion',
    detail: `This page surfaced as one of the weaker structural assets in the crawl. Tightening its metadata, proof, and internal links will make the next expansion layer compound better.`,
    page: trimTitle(page.title || page.url),
    severity: 'medium'
  }));
}

function buildLinkOpportunities(pageMap, markets, services) {
  const items = [];
  const hubs = pageMap.filter((page) => page.pageType === 'Hub page');
  const marketPages = pageMap.filter((page) => page.pageType === 'Market page');
  const pairPages = pageMap.filter((page) => page.pageType === 'Market + service page');

  if (hubs.length && marketPages.length) {
    items.push({
      title: 'Strengthen hub-to-market linking',
      detail: `The site has ${hubs.length} hub-style page${hubs.length === 1 ? '' : 's'} and ${marketPages.length} market page${marketPages.length === 1 ? '' : 's'}. The next gain is making sure each hub clearly routes into the highest-priority market pages.`
    });
  }

  if (marketPages.length && pairPages.length < markets.length * Math.min(services.length, 2)) {
    items.push({
      title: 'Link market pages down into service variants',
      detail: 'The crawl found local market pages, but not enough evidence that they are feeding users into local service or situation pages. That weakens both discovery and local topical depth.'
    });
  }

  const weakPages = pageMap.filter((page) => page.internalLinkCount < 3 && (page.market || page.service)).slice(0, 3);
  weakPages.forEach((page) => {
    items.push({
      title: `Increase internal links pointing to ${page.title || page.url}`,
      detail: `This page only exposed about ${page.internalLinkCount} internal link${page.internalLinkCount === 1 ? '' : 's'} during the crawl. It likely needs clearer support from nearby hubs, related markets, or related services.`
    });
  });

  return items.slice(0, 6);
}

function buildBlueprints(gaps, pageMap, input) {
  const hubSource = pageMap.find((page) => page.pageType === 'Hub page') || pageMap.find((page) => page.market === input.primaryMarket);

  return gaps.slice(0, 6).map((gap) => {
    const slugBase = [gap.market, gap.service]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return {
      title: gap.service
        ? `${capitalize(gap.service)} in ${gap.market}`
        : `${gap.market} Local SEO Landing Page`,
      detail: gap.service
        ? `Create a local page that pairs ${gap.service} with ${gap.market}, includes a strong local H1, proof blocks, FAQ depth, and links back into the surrounding market cluster.`
        : `Create the market hub for ${gap.market} first, then use it to route into service-specific pages and stronger internal links.`,
      slug: `${slugBase || 'new-page'}.html`,
      internalLinkFrom: hubSource ? trimTitle(hubSource.title || hubSource.url) : 'service-area hub',
      titleTag: gap.service
        ? `${capitalize(gap.service)} in ${gap.market} | Local Help`
        : `${gap.market} Service Area | Local Coverage`,
      h1: gap.service
        ? `${capitalize(gap.service)} in ${gap.market}`
        : `${gap.market} Local Service Area`,
      sections: gap.service
        ? ['Local problem framing', 'Why owners in this market call', 'Process overview', 'Proof / FAQ', 'Related local links']
        : ['Market overview', 'Services covered', 'Proof / FAQ', 'Connected markets', 'Conversion CTA']
    };
  });
}

function buildContentBriefs(blueprints, input) {
  return blueprints.slice(0, 4).map((item) => ({
    title: item.title,
    summary: `This page should target a direct local-intent query, explain why ${input.primaryService} matters in that market, and route visitors deeper into the surrounding local cluster.`,
    keyword: item.titleTag || item.title,
    intent: 'Local transactional',
    sections: item.sections || []
  }));
}

function buildClusterMap(markets, services, pageMap) {
  const nodes = [];
  const edges = [];

  markets.forEach((market) => {
    const marketPage = pageMap.find((page) => page.market === market && page.pageType !== 'General page');
    nodes.push({
      id: `market:${market}`,
      market,
      label: market,
      type: 'market',
      state: marketPage ? 'existing' : 'missing'
    });

    services.slice(0, 5).forEach((service) => {
      const pairPage = pageMap.find((page) => page.market === market && page.service === service);
      nodes.push({
        id: `pair:${market}:${service}`,
        market,
        label: service,
        type: 'service pairing',
        state: pairPage ? 'existing' : 'missing'
      });
      edges.push({
        from: `market:${market}`,
        to: `pair:${market}:${service}`,
        state: pairPage ? 'existing' : 'recommended'
      });
    });
  });

  return {
    status: 'Mapped',
    markets: markets.map((market) => ({ name: market })),
    nodes,
    edges
  };
}

function buildPriorities(scores, gaps, pageMap, weakest) {
  const list = [];

  if (weakest === 'coverage') {
    list.push({
      title: 'Build the missing market footprint before polishing weaker details',
      detail: `The biggest issue is coverage. The engine found ${gaps.length} notable market or service gaps, which means the site is structurally under-expanded for the markets you want to own.`,
      level: 'critical'
    });
  }

  if (weakest === 'quality') {
    const weakCount = pageMap.filter((page) => page.qualityScore < 60).length;
    list.push({
      title: 'Strengthen the local pages that already exist',
      detail: `${weakCount} scanned page${weakCount === 1 ? '' : 's'} look structurally weak enough that expansion alone will not solve the ranking problem. The next move is stronger page quality: titles, H1s, copy depth, proof, and conversion structure.`,
      level: 'critical'
    });
  }

  if (weakest === 'linking') {
    list.push({
      title: 'Fix isolated pages before adding too many more',
      detail: 'The crawl suggests the local pages are not reinforcing each other well enough. Stronger hub-to-market and market-to-service linking is needed before the footprint compounds properly.',
      level: 'critical'
    });
  }

  if (gaps.length) {
    list.push({
      title: 'Prioritize paired local pages, not just broad market pages',
      detail: 'The strongest next assets are pages that combine the target market with the specific service or situation. Those are the clearest gaps the engine found.',
      level: 'high'
    });
  }

  if (scores.quality < 70) {
    list.push({
      title: 'Raise the quality floor across the local page set',
      detail: 'Several pages appear too light on metadata, H1 structure, proof, or local depth. Expansion works better once the existing pages deserve to rank.',
      level: 'high'
    });
  }

  if (scores.linking < 70) {
    list.push({
      title: 'Use hubs to feed authority into the local cluster',
      detail: 'Create a deliberate internal-link plan from hubs, counties, cities, and service guides into the highest-priority local targets.',
      level: 'medium'
    });
  }

  return list.slice(0, 4);
}

function buildHeadline(scores, weakest) {
  const map = {
    coverage: 'The local footprint is underbuilt for the markets you want to own.',
    quality: 'The site has local pages, but too many of them still look structurally weak.',
    linking: 'The local page set is not reinforcing itself strongly enough yet.',
    readiness: 'The local SEO system has a base, but it is not fully ready to compound.'
  };
  return map[weakest] || 'The local expansion system has clear room to get stronger.';
}

function buildSummary(scores, gaps, pageCount, coveredMarkets, totalMarkets) {
  return `The engine analyzed ${pageCount} page${pageCount === 1 ? '' : 's'}, found coverage in ${coveredMarkets} of ${totalMarkets} target market${totalMarkets === 1 ? '' : 's'}, and surfaced ${gaps.length} notable market/service opportunities. The next gains are coming from a better local page map, stronger page structure, and cleaner internal-link support.`;
}

function buildFallbackBlocks(scores, gaps, pageMap, input) {
  const bestPage = [...pageMap].sort((a, b) => b.qualityScore - a.qualityScore)[0];
  const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0];

  return [
    `The biggest structural pressure point is ${weakest}. That means the site needs more than small on-page edits if it wants to expand local visibility cleanly.`,
    gaps.length
      ? `The clearest next wins are the missing market and service pairings, especially around ${gaps.slice(0, 3).map((gap) => gap.market || gap.service).filter(Boolean).join(', ')}.`
      : 'The site appears to cover the submitted target map at a basic level, so the next leverage is quality and internal-link refinement.',
    bestPage
      ? `The strongest existing page the engine found is "${trimTitle(bestPage.title || bestPage.url)}". Use that page as the structural model for the next local pages you build.`
      : `The scan did not surface a clear standout local page, so the next pages should be built from a stronger template around ${input.primaryService} in ${input.primaryMarket}.`
  ];
}

async function generateAiRead(input, crawl, engineResult) {
  const prompt = `
You are Local SEO Expansion Engine, an operator-grade local SEO strategist.
You are given:
1. intake inputs
2. a crawl summary of the website
3. classified pages with markets/services/page quality
4. heuristic scores and detected gaps

Return strict JSON with:
- blocks: array of 4 concise but strategic paragraphs

Your job:
- explain what the site is missing
- identify the highest-value next local pages to build
- explain what internal-linking change matters most
- make the output feel like a sharp consultant read, not a generic audit

Inputs:
${JSON.stringify(input, null, 2)}

Crawl summary:
${JSON.stringify({
  pages: crawl.pages.slice(0, 12).map((page) => ({
    url: page.url,
    title: page.title,
    h1s: page.h1s,
    wordCount: page.wordCount,
    forms: page.forms,
    internalLinkCount: page.internalLinkCount,
    proofSignals: page.proofSignals
  })),
  discovered: crawl.discovered
}, null, 2)}

Engine result:
${JSON.stringify({
  scores: engineResult.scores,
  headline: engineResult.headline,
  summary: engineResult.summary,
  gaps: engineResult.gaps.slice(0, 8),
  inventory: engineResult.inventory.slice(0, 8),
  callouts: engineResult.callouts.slice(0, 6),
  clusterMap: engineResult.clusterMap,
  linkOpportunities: engineResult.linkOpportunities.slice(0, 6),
  blueprints: engineResult.blueprints.slice(0, 6),
  contentBriefs: engineResult.contentBriefs.slice(0, 4),
  competitorComparison: engineResult.competitorComparison
}, null, 2)}

Be specific, practical, and local-search focused. Avoid fluff.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      input: prompt,
      text: { format: { type: 'json_object' } }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'OpenAI request failed');
  }

  const data = await response.json();
  const rawText =
    data.output_text ||
    data.output?.map((item) => item?.content?.map((c) => c?.text || '').join('')).join('') ||
    '{}';

  try {
    const parsed = JSON.parse(rawText);
    return {
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks.filter(Boolean).slice(0, 4) : engineResult.aiAnalysis.blocks
    };
  } catch {
    return { blocks: engineResult.aiAnalysis.blocks };
  }
}

function scoreCoverage(markets, services, pageMap) {
  const marketCoverage = uniqueNormalized(pageMap.map((page) => page.market).filter(Boolean)).length / Math.max(markets.length, 1);
  const pairCount = new Set(pageMap.filter((page) => page.pairKey).map((page) => page.pairKey)).size;
  const expectedPairs = Math.max(markets.length * Math.max(Math.min(services.length, 3), 1), 1);
  return clamp(Math.round((marketCoverage * 55) + ((pairCount / expectedPairs) * 45)));
}

function scoreQuality(pageMap) {
  if (!pageMap.length) return 0;
  const values = pageMap.map((page) => page.qualityScore);
  return clamp(Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
}

function scoreLinking(pageMap) {
  const localPages = pageMap.filter((page) => page.market || page.service);
  if (!localPages.length) return 20;

  const averageLinks = localPages.reduce((sum, page) => sum + page.internalLinkCount, 0) / localPages.length;
  const hubCount = pageMap.filter((page) => page.pageType === 'Hub page').length;
  const pairCount = pageMap.filter((page) => page.pageType === 'Market + service page').length;
  return clamp(Math.round((Math.min(averageLinks, 12) / 12) * 65 + Math.min(hubCount * 7, 14) + Math.min(pairCount * 2, 21)));
}

function competitorReadout(pageCount, marketCoverage, servicePairs) {
  if (!pageCount) return 'The crawl did not return enough usable pages to compare meaningfully.';
  return `The engine found about ${pageCount} crawlable page${pageCount === 1 ? '' : 's'}, ${marketCoverage} target-market signal${marketCoverage === 1 ? '' : 's'}, and ${servicePairs} market-service pairing${servicePairs === 1 ? '' : 's'}.`;
}

function summarizeCompetitors(items, engineResult) {
  const viable = items.filter((item) => item.pagesAnalyzed > 0);
  if (!viable.length) {
    return 'The competitor crawl did not return enough usable data to create a meaningful comparison.';
  }

  const bestCoverage = viable.reduce((best, item) => item.marketCoverage > best.marketCoverage ? item : best, viable[0]);
  const bestPairs = viable.reduce((best, item) => item.servicePairs > best.servicePairs ? item : best, viable[0]);
  return `The strongest competitor footprint signal came from ${bestCoverage.label} on market coverage and ${bestPairs.label} on market-service pairings. Use that contrast to decide whether your next advantage should come from broader market hubs or deeper paired pages first.`;
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return cleanString(url);
  }
}

function scorePage(page, hasMarket, hasService) {
  let score = 0;
  score += page.title ? 12 : 0;
  score += page.metaDescription ? 8 : 0;
  score += page.h1s.length ? 12 : 0;
  score += between(page.wordCount, 350, 2400) ? 16 : page.wordCount > 150 ? 8 : 0;
  score += page.forms ? 8 : 0;
  score += page.phoneVisible ? 5 : 0;
  score += page.emailVisible ? 3 : 0;
  score += page.proofSignals > 0 ? 8 : 0;
  score += page.faqSignals > 0 ? 6 : 0;
  score += page.hasSchemaSignal ? 6 : 0;
  score += Math.min(page.internalLinkCount, 10);
  score += hasMarket ? 4 : 0;
  score += hasService ? 2 : 0;
  return clamp(score);
}

function between(value, min, max) {
  return value >= min && value <= max;
}

function uniqueNormalized(values) {
  const seen = new Set();
  const items = [];
  values.forEach((value) => {
    const text = cleanString(value);
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      items.push(text);
    }
  });
  return items;
}

function trimTitle(value) {
  const text = cleanString(value);
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function capitalize(value) {
  const text = cleanString(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function countKeywordHits(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.reduce((count, keyword) => count + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function cleanText(text) {
  return stripTags(text).replace(/\s+/g, ' ').trim();
}

function matchOne(html, regex) {
  const match = String(html || '').match(regex);
  return match?.[1] || '';
}

function matchAll(html, regex) {
  const values = [];
  let match;
  while ((match = regex.exec(String(html || ''))) !== null) {
    values.push(match[1] || '');
  }
  return values;
}

function matchMeta(html, name) {
  const regexA = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i');
  const regexB = new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+name=["']${name}["'][^>]*>`, 'i');
  return matchOne(html, regexA) || matchOne(html, regexB);
}

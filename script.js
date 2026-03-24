const form = document.getElementById('engineForm');
const runEngineBtn = document.getElementById('runEngineBtn');
const rerunAiBtn = document.getElementById('rerunAiBtn');
const downloadReportBtn = document.getElementById('downloadReportBtn');
const scanBadge = document.getElementById('scanBadge');
const emptyState = document.getElementById('emptyState');
const resultsContent = document.getElementById('resultsContent');
const coverageScore = document.getElementById('coverageScore');
const coverageLabel = document.getElementById('coverageLabel');
const qualityScore = document.getElementById('qualityScore');
const qualityLabel = document.getElementById('qualityLabel');
const linkingScore = document.getElementById('linkingScore');
const linkingLabel = document.getElementById('linkingLabel');
const readinessScore = document.getElementById('readinessScore');
const readinessLabel = document.getElementById('readinessLabel');
const overallHeadline = document.getElementById('overallHeadline');
const overallSummary = document.getElementById('overallSummary');
const crawlStatus = document.getElementById('crawlStatus');
const crawlSnapshot = document.getElementById('crawlSnapshot');
const priorityList = document.getElementById('priorityList');
const gapList = document.getElementById('gapList');
const inventoryList = document.getElementById('inventoryList');
const calloutList = document.getElementById('calloutList');
const clusterStatus = document.getElementById('clusterStatus');
const clusterMap = document.getElementById('clusterMap');
const linkOpportunities = document.getElementById('linkOpportunities');
const blueprintList = document.getElementById('blueprintList');
const briefList = document.getElementById('briefList');
const competitorStatus = document.getElementById('competitorStatus');
const competitorComparison = document.getElementById('competitorComparison');
const aiStatus = document.getElementById('aiStatus');
const aiAnalysis = document.getElementById('aiAnalysis');
const reportGateForm = document.getElementById('reportGateForm');
const reportStatus = document.getElementById('reportStatus');

let lastPayload = null;
let lastResult = null;
let reportUnlocked = false;

document.addEventListener('DOMContentLoaded', () => {
  bindSmoothScroll();
  bindForm();
  bindReportGate();
});

function bindSmoothScroll() {
  const links = document.querySelectorAll('a[href^="#"]');
  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      const id = link.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function bindForm() {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = serializeForm();
    if (!payload.website || !payload.primaryService || !payload.primaryMarket) {
      form.reportValidity();
      return;
    }

    lastPayload = payload;
    setLoadingState(true, 'Scanning');
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      lastResult = data;
      reportUnlocked = false;
      renderResults(data);
      document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      renderFailure(error);
    } finally {
      setLoadingState(false);
    }
  });

  rerunAiBtn.addEventListener('click', async () => {
    if (!lastPayload) return;
    setLoadingState(true, 'Refreshing');
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lastPayload, refreshAi: true })
      });

      const data = await response.json();
      lastResult = data;
      renderResults(data);
    } catch (error) {
      renderFailure(error);
    } finally {
      setLoadingState(false);
    }
  });
}

function bindReportGate() {
  reportGateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!lastResult) return;

    const lead = getLeadDetails();
    if (!lead.name || !lead.phone || !lead.email) {
      reportGateForm.reportValidity();
      return;
    }

    reportUnlocked = true;
    reportStatus.textContent = 'Unlocked';
    downloadReportBtn.disabled = false;
    downloadReport();
  });

  downloadReportBtn.addEventListener('click', () => {
    if (!lastResult || !reportUnlocked) {
      reportGateForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    downloadReport();
  });
}

function serializeForm() {
  const formData = new FormData(form);
  const raw = Object.fromEntries(formData.entries());

  return {
    website: normalizeUrl(raw.website),
    primaryService: cleanString(raw.primaryService),
    primaryMarket: cleanString(raw.primaryMarket),
    targetMarkets: splitList(raw.targetMarkets),
    targetServices: splitList(raw.targetServices),
    businessType: cleanString(raw.businessType),
    notes: cleanString(raw.notes),
    competitors: splitList(raw.competitors).slice(0, 2)
  };
}

function normalizeUrl(value) {
  const input = cleanString(value);
  if (!input) return '';
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

function splitList(value) {
  return cleanString(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanString(value) {
  return String(value || '').trim();
}

function setLoadingState(active, label = 'Ready') {
  runEngineBtn.disabled = active;
  rerunAiBtn.disabled = active || !lastPayload;
  scanBadge.textContent = active ? label : 'Ready';
  scanBadge.className = `scan-badge ${active ? 'scanning' : 'ready'}`;

  if (active) {
    emptyState.classList.add('hidden');
    resultsContent.classList.remove('hidden');
    overallHeadline.textContent = 'Scanning the current footprint...';
    overallSummary.textContent = 'Crawling the site, classifying local pages, and building the expansion map.';
    crawlStatus.textContent = 'Scanning site';
    crawlSnapshot.innerHTML = '<p>The engine is inventorying pages, headings, metadata, forms, proof signals, and internal links.</p>';
    calloutList.innerHTML = '<article class="callout-item"><strong>Scanning key pages</strong><span>The engine is evaluating headlines, CTA placement, proof signals, metadata, and local relevance across the crawl.</span></article>';
    clusterStatus.textContent = 'Building map';
    clusterMap.innerHTML = '<div class="cluster-empty">The engine is mapping hubs, market pages, and missing page clusters.</div>';
    competitorStatus.textContent = 'Pending';
    competitorComparison.innerHTML = '<div class="competitor-empty">Competitor comparison will appear if competitor sites were provided.</div>';
    briefList.innerHTML = '<article class="brief-item"><strong>Generating content briefs</strong><span>The engine is turning the highest-priority page recommendations into tighter page build guidance.</span></article>';
    aiStatus.textContent = 'Working';
    aiAnalysis.innerHTML = '<p>Building the expansion strategy based on the crawl.</p>';
    reportStatus.textContent = 'Locked';
    downloadReportBtn.disabled = true;
  }
}

function renderResults(data) {
  emptyState.classList.add('hidden');
  resultsContent.classList.remove('hidden');

  setScore(coverageScore, coverageLabel, data.scores?.coverage || 0);
  setScore(qualityScore, qualityLabel, data.scores?.quality || 0);
  setScore(linkingScore, linkingLabel, data.scores?.linking || 0);
  setScore(readinessScore, readinessLabel, data.scores?.readiness || 0);

  overallHeadline.textContent = data.headline || 'Expansion analysis complete';
  overallSummary.textContent = data.summary || 'The engine mapped the current local footprint and produced the next best expansion moves.';

  const crawl = data.crawl || {};
  crawlStatus.textContent = crawl.statusLabel || 'Complete';
  crawlSnapshot.innerHTML = `
    <p><strong>Pages analyzed:</strong> ${Number(crawl.pagesAnalyzed || 0)} | <strong>Local pages found:</strong> ${Number(crawl.localPages || 0)} | <strong>Target markets covered:</strong> ${Number(crawl.coveredMarkets || 0)} of ${Number(crawl.totalMarkets || 0)}</p>
    <p><strong>What it recognized:</strong> ${escapeHtml(crawl.note || 'The engine identified page coverage, service-market pairings, and internal-link patterns across the scanned site.')}</p>
  `;

  aiStatus.textContent = data.mode === 'ai' ? 'AI mode' : 'Heuristic mode';
  aiAnalysis.innerHTML = '';
  (data.aiAnalysis?.blocks || []).forEach((block) => {
    const p = document.createElement('p');
    p.textContent = block;
    aiAnalysis.appendChild(p);
  });

  renderPriorityList(priorityList, data.priorities || []);
  renderGapList(gapList, data.gaps || []);
  renderInventoryList(inventoryList, data.inventory || []);
  renderCallouts(calloutList, data.callouts || []);
  renderClusterMap(data.clusterMap || {});
  renderActionList(linkOpportunities, data.linkOpportunities || []);
  renderBlueprints(blueprintList, data.blueprints || []);
  renderBriefs(briefList, data.contentBriefs || []);
  renderCompetitors(data.competitorComparison || {});

  scanBadge.textContent = 'Complete';
  scanBadge.className = 'scan-badge complete';
}

function renderPriorityList(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<article class="priority-item" data-level="medium"><strong>No urgent structural issues were identified.</strong><span>The engine did not see a major bottleneck, so the next focus should be on compounding coverage and sharpening stronger pages.</span></article>';
    return;
  }

  items.forEach((item, index) => {
    const article = document.createElement('article');
    article.className = 'priority-item';
    article.dataset.level = item.level || 'medium';
    article.innerHTML = `<strong>#${index + 1} ${escapeHtml(item.title || 'Priority')}</strong><span>${escapeHtml(item.detail || '')}</span>`;
    container.appendChild(article);
  });
}

function renderGapList(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<article class="gap-item"><strong>No major market/service gaps were detected.</strong><span>The current footprint appears to cover the submitted targets at a basic level. The next gains are likely page quality and link structure.</span></article>';
    return;
  }

  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'gap-item';
    article.innerHTML = `
      <strong>${escapeHtml(item.title || 'Gap')}</strong>
      <span>${escapeHtml(item.detail || '')}</span>
      <div class="inventory-meta">
        ${renderChip(item.priority || 'Expansion', chipTone(item.level || 'high'))}
        ${item.market ? renderChip(item.market, 'info') : ''}
        ${item.service ? renderChip(item.service, 'warn') : ''}
      </div>
    `;
    container.appendChild(article);
  });
}

function renderInventoryList(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<article class="inventory-item"><strong>No inventory snapshot available.</strong><span>The crawl did not return enough usable page data to render an inventory list.</span></article>';
    return;
  }

  items.slice(0, 8).forEach((item) => {
    const article = document.createElement('article');
    article.className = 'inventory-item';
    article.innerHTML = `
      <strong>${escapeHtml(item.title || item.url || 'Page')}</strong>
      <span>${escapeHtml(item.summary || '')}</span>
      <div class="inventory-meta">
        ${renderChip(item.pageType || 'Page', 'info')}
        ${renderChip(`${item.qualityScore || 0} quality`, qualityTone(item.qualityScore || 0))}
        ${item.market ? renderChip(item.market, 'good') : ''}
        ${item.service ? renderChip(item.service, 'warn') : ''}
      </div>
    `;
    container.appendChild(article);
  });
}

function renderActionList(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<article class="action-item"><strong>No obvious link opportunities were generated.</strong><span>The current crawl did not surface a clear internal-link pattern to fix first.</span></article>';
    return;
  }

  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'action-item';
    article.innerHTML = `<strong>${escapeHtml(item.title || 'Opportunity')}</strong><span>${escapeHtml(item.detail || '')}</span>`;
    container.appendChild(article);
  });
}

function renderBlueprints(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<article class="blueprint-item"><strong>No blueprint recommendations yet.</strong><span>Provide more target markets or services so the engine can propose the next local pages to build.</span></article>';
    return;
  }

  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'blueprint-item';
    const sectionChips = Array.isArray(item.sections)
      ? item.sections.map((section) => renderChip(section, 'warn')).join('')
      : '';
    article.innerHTML = `
      <strong>${escapeHtml(item.title || 'Recommended page')}</strong>
      <span>${escapeHtml(item.detail || '')}</span>
      <div class="blueprint-meta">
        ${item.slug ? renderChip(item.slug, 'info') : ''}
        ${item.internalLinkFrom ? renderChip(`Link from ${item.internalLinkFrom}`, 'good') : ''}
        ${item.titleTag ? renderChip(`Title: ${item.titleTag}`, 'info') : ''}
        ${item.h1 ? renderChip(`H1: ${item.h1}`, 'good') : ''}
        ${sectionChips}
      </div>
    `;
    container.appendChild(article);
  });
}

function renderClusterMap(data) {
  clusterMap.innerHTML = '';
  const markets = Array.isArray(data.markets) ? data.markets : [];
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];

  if (!markets.length && !nodes.length) {
    clusterStatus.textContent = 'Unavailable';
    clusterMap.innerHTML = '<div class="cluster-empty">The crawl did not return enough market structure to draw the cluster map.</div>';
    return;
  }

  clusterStatus.textContent = data.status || 'Mapped';

  markets.forEach((market) => {
    const wrap = document.createElement('article');
    wrap.className = 'market-column';

    const marketNodes = nodes.filter((node) => node.market === market.name);
    const existingCount = marketNodes.filter((node) => node.state === 'existing').length;
    const missingCount = marketNodes.filter((node) => node.state === 'missing').length;

    wrap.innerHTML = `
      <div class="market-column-head">
        <strong>${escapeHtml(market.name)}</strong>
        <span>${existingCount} existing / ${missingCount} missing</span>
      </div>
      <div class="market-column-body"></div>
    `;

    const body = wrap.querySelector('.market-column-body');
    marketNodes.forEach((node) => {
      const card = document.createElement('div');
      card.className = `cluster-node ${node.state || 'existing'}`;
      card.innerHTML = `
        <strong>${escapeHtml(node.label || 'Node')}</strong>
        <span>${escapeHtml(node.type || 'page')}</span>
      `;
      body.appendChild(card);
    });

    clusterMap.appendChild(wrap);
  });

  if (edges.length) {
    const foot = document.createElement('div');
    foot.className = 'cluster-links-summary';
    foot.textContent = `${edges.length} recommended internal-link path${edges.length === 1 ? '' : 's'} identified across the local cluster.`;
    clusterMap.appendChild(foot);
  }
}

function renderCompetitors(data) {
  competitorComparison.innerHTML = '';
  const competitors = Array.isArray(data.items) ? data.items : [];

  if (!competitors.length) {
    competitorStatus.textContent = 'Not run';
    competitorComparison.innerHTML = '<div class="competitor-empty">Add one or two competitor websites in the workspace to compare local footprint signals.</div>';
    return;
  }

  competitorStatus.textContent = 'Compared';

  competitors.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'competitor-card';
    card.innerHTML = `
      <strong>${escapeHtml(item.label || item.website || 'Competitor')}</strong>
      <span>${escapeHtml(item.readout || '')}</span>
      <div class="inventory-meta">
        ${renderChip(`${item.pagesAnalyzed || 0} pages`, 'info')}
        ${renderChip(`${item.marketCoverage || 0} market hits`, item.marketCoverage > 0 ? 'good' : 'bad')}
        ${renderChip(`${item.servicePairs || 0} service pairs`, item.servicePairs > 0 ? 'warn' : 'bad')}
      </div>
    `;
    competitorComparison.appendChild(card);
  });

  if (data.summary) {
    const summary = document.createElement('article');
    summary.className = 'competitor-card competitor-card-summary';
    summary.innerHTML = `<strong>Competitive read</strong><span>${escapeHtml(data.summary)}</span>`;
    competitorComparison.appendChild(summary);
  }
}

function renderCallouts(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<article class="callout-item"><strong>No clear page callouts yet.</strong><span>The scan did not produce enough signal to isolate the highest-priority page-level findings.</span></article>';
    return;
  }

  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'callout-item';
    article.innerHTML = `
      <strong>${escapeHtml(item.title || 'Callout')}</strong>
      <span>${escapeHtml(item.detail || '')}</span>
      <div class="inventory-meta">
        ${item.page ? renderChip(item.page, 'info') : ''}
        ${item.severity ? renderChip(item.severity, chipTone(item.severity)) : ''}
      </div>
    `;
    container.appendChild(article);
  });
}

function renderBriefs(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<article class="brief-item"><strong>No content briefs available yet.</strong><span>The engine needs stronger target market or service inputs before it can generate the best page brief set.</span></article>';
    return;
  }

  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'brief-item';
    const sectionChips = Array.isArray(item.sections)
      ? item.sections.map((section) => renderChip(section, 'warn')).join('')
      : '';
    article.innerHTML = `
      <strong>${escapeHtml(item.title || 'Content brief')}</strong>
      <span>${escapeHtml(item.summary || '')}</span>
      <div class="blueprint-meta">
        ${item.keyword ? renderChip(item.keyword, 'good') : ''}
        ${item.intent ? renderChip(item.intent, 'info') : ''}
        ${sectionChips}
      </div>
    `;
    container.appendChild(article);
  });
}

function renderFailure(error) {
  emptyState.classList.add('hidden');
  resultsContent.classList.remove('hidden');
  scanBadge.textContent = 'Issue';
  scanBadge.className = 'scan-badge warning';
  overallHeadline.textContent = 'The engine could not complete the scan.';
  overallSummary.textContent = 'The request failed before the crawl could finish. Check the submitted domain and try again.';
  crawlStatus.textContent = 'Unavailable';
  crawlSnapshot.innerHTML = `<p>${escapeHtml(error.message || 'Unknown error')}</p>`;
  calloutList.innerHTML = '<article class="callout-item"><strong>Callouts unavailable</strong><span>The scan failed before page-level findings could be generated.</span></article>';
  clusterStatus.textContent = 'Unavailable';
  clusterMap.innerHTML = '<div class="cluster-empty">The cluster map could not be built because the scan failed.</div>';
  briefList.innerHTML = '<article class="brief-item"><strong>Content briefs unavailable</strong><span>The scan failed before page briefs could be generated.</span></article>';
  competitorStatus.textContent = 'Unavailable';
  competitorComparison.innerHTML = '<div class="competitor-empty">Competitor comparison is unavailable because the scan failed.</div>';
  aiStatus.textContent = 'Unavailable';
  aiAnalysis.innerHTML = '<p>The expansion strategy could not be generated because the crawl failed.</p>';
  reportStatus.textContent = 'Locked';
  downloadReportBtn.disabled = true;
}

function setScore(valueEl, labelEl, value) {
  valueEl.textContent = value;
  labelEl.textContent = scoreLabel(value);
}

function scoreLabel(value) {
  if (value < 45) return 'Underbuilt';
  if (value < 65) return 'Needs work';
  if (value < 80) return 'Stable';
  return 'Strong';
}

function chipTone(level) {
  if (level === 'critical') return 'bad';
  if (level === 'medium') return 'info';
  return 'warn';
}

function qualityTone(value) {
  if (value < 45) return 'bad';
  if (value < 70) return 'warn';
  return 'good';
}

function renderChip(text, tone) {
  return `<span class="chip ${tone}">${escapeHtml(text)}</span>`;
}

function getLeadDetails() {
  const formData = new FormData(reportGateForm);
  return {
    name: cleanString(formData.get('leadName')),
    phone: cleanString(formData.get('leadPhone')),
    email: cleanString(formData.get('leadEmail'))
  };
}

function downloadReport() {
  if (!lastResult) return;
  const lead = getLeadDetails();
  const content = buildReportHtml(lastResult, lead);
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `local-seo-expansion-report-${Date.now()}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildReportHtml(result, lead) {
  const section = (title, items) => `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <div class="stack">
        ${items.map((item) => `<article class="card"><strong>${escapeHtml(item.title || '')}</strong><p>${escapeHtml(item.detail || item.summary || '')}</p></article>`).join('')}
      </div>
    </section>
  `;

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Local SEO Expansion Report</title>
    <style>
      body{font-family:Arial,sans-serif;background:#0b1220;color:#f4f7ff;margin:0;padding:40px;}
      .shell{max-width:980px;margin:0 auto;}
      h1,h2{margin:0 0 16px;}
      p{line-height:1.6;color:#c8d4ea;}
      .hero,.card{background:#121c30;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:20px;}
      .hero{margin-bottom:24px;}
      .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:24px 0;}
      .stack{display:grid;gap:12px;}
      .chip{display:inline-block;padding:6px 10px;border-radius:999px;background:#1d3155;color:#dce9ff;margin:6px 8px 0 0;font-size:12px;text-transform:uppercase;}
      section{margin-top:26px;}
      @media (max-width:700px){body{padding:20px;}.grid{grid-template-columns:1fr;}}
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="hero">
        <h1>Local SEO Expansion Report</h1>
        <p><strong>Prepared for:</strong> ${escapeHtml(lead.name)} | ${escapeHtml(lead.email)} | ${escapeHtml(lead.phone)}</p>
        <p>${escapeHtml(result.summary || '')}</p>
        <div>
          <span class="chip">Coverage ${result.scores?.coverage || 0}</span>
          <span class="chip">Quality ${result.scores?.quality || 0}</span>
          <span class="chip">Internal Links ${result.scores?.linking || 0}</span>
          <span class="chip">Readiness ${result.scores?.readiness || 0}</span>
        </div>
      </div>
      ${section('Priority Stack', result.priorities || [])}
      ${section('Page Callouts', result.callouts || [])}
      ${section('Missing Opportunities', result.gaps || [])}
      ${section('Blueprint Recommendations', result.blueprints || [])}
      ${section('Content Briefs', result.contentBriefs || [])}
    </div>
  </body>
  </html>`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

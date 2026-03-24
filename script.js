const form = document.getElementById('engineForm');
const runEngineBtn = document.getElementById('runEngineBtn');
const rerunAiBtn = document.getElementById('rerunAiBtn');
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
const linkOpportunities = document.getElementById('linkOpportunities');
const blueprintList = document.getElementById('blueprintList');
const aiStatus = document.getElementById('aiStatus');
const aiAnalysis = document.getElementById('aiAnalysis');

let lastPayload = null;

document.addEventListener('DOMContentLoaded', () => {
  bindSmoothScroll();
  bindForm();
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
      renderResults(data);
    } catch (error) {
      renderFailure(error);
    } finally {
      setLoadingState(false);
    }
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
    notes: cleanString(raw.notes)
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
    aiStatus.textContent = 'Working';
    aiAnalysis.innerHTML = '<p>Building the expansion strategy based on the crawl.</p>';
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
  renderActionList(linkOpportunities, data.linkOpportunities || []);
  renderBlueprints(blueprintList, data.blueprints || []);

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
    article.innerHTML = `
      <strong>${escapeHtml(item.title || 'Recommended page')}</strong>
      <span>${escapeHtml(item.detail || '')}</span>
      <div class="blueprint-meta">
        ${item.slug ? renderChip(item.slug, 'info') : ''}
        ${item.internalLinkFrom ? renderChip(`Link from ${item.internalLinkFrom}`, 'good') : ''}
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
  aiStatus.textContent = 'Unavailable';
  aiAnalysis.innerHTML = '<p>The expansion strategy could not be generated because the crawl failed.</p>';
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

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

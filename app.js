(function () {
  'use strict';

  // ---- DOM refs ----
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const gridArea = document.getElementById('grid-area');
  const gridContainer = document.getElementById('grid-container');
  const canvas = document.getElementById('grid-canvas');
  const ctx = canvas.getContext('2d');
  const scrollTrack = document.getElementById('scrollbar-track');
  const scrollThumb = document.getElementById('scrollbar-thumb');
  const fileInfoText = document.getElementById('file-info-text');
  const loadFileBtn = document.getElementById('load-file-btn');
  const searchesArea = document.getElementById('searches-area');
  const addSearchBtn = document.getElementById('add-search-btn');
  const themeToggle = document.getElementById('theme-toggle');

  // ---- Theme toggle ----

  function getGridTextColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--grid-text').trim();
  }

  function getBgColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  }

  function setTheme(mode) {
    const root = document.documentElement;
    if (mode === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', mode);
    }

    // Update toggle button states
    themeToggle.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === mode);
    });

    // Persist preference
    try { localStorage.setItem('els-theme', mode); } catch (e) {}

    // Re-render canvas with new colors
    scheduleRender();
  }

  themeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-theme]');
    if (btn) setTheme(btn.dataset.theme);
  });

  // Restore saved preference on load (deferred so all vars are declared)
  requestAnimationFrame(() => {
    let saved;
    try { saved = localStorage.getItem('els-theme'); } catch (e) {}
    setTheme(saved || 'auto');
  });

  // ---- Color palette for searches ----
  const COLORS = [
    { bg: 'rgba(233, 69, 96, 0.25)',  text: '#ff6b81',  line: 'rgba(233, 69, 96, 0.7)',  dot: '#e94560'  },
    { bg: 'rgba(87, 200, 255, 0.25)', text: '#57c8ff',  line: 'rgba(87, 200, 255, 0.7)', dot: '#57c8ff'  },
    { bg: 'rgba(80, 220, 100, 0.25)', text: '#50dc64',  line: 'rgba(80, 220, 100, 0.7)', dot: '#50dc64'  },
    { bg: 'rgba(255, 200, 50, 0.25)', text: '#ffc832',  line: 'rgba(255, 200, 50, 0.7)', dot: '#ffc832'  },
    { bg: 'rgba(200, 120, 255, 0.25)',text: '#c878ff',  line: 'rgba(200, 120, 255, 0.7)',dot: '#c878ff'  },
    { bg: 'rgba(255, 150, 80, 0.25)', text: '#ff9650',  line: 'rgba(255, 150, 80, 0.7)', dot: '#ff9650'  },
    { bg: 'rgba(100, 255, 218, 0.25)',text: '#64ffda',  line: 'rgba(100, 255, 218, 0.7)',dot: '#64ffda'  },
    { bg: 'rgba(255, 120, 200, 0.25)',text: '#ff78c8',  line: 'rgba(255, 120, 200, 0.7)',dot: '#ff78c8'  },
  ];

  // ---- State ----
  let cleanedText = '';
  let originalChars = [];
  let gridCols = 0;
  let totalRows = 0;
  let rowHeight = 0;
  let cellWidth = 0;
  let baselineOffset = 0;
  let visibleRows = 0;
  let scrollRow = 0;
  let maxScrollRow = 0;
  let renderScheduled = false;
  let dpr = 1;

  // Multi-search state
  let nextSearchId = 0;
  let searches = [];
  let highlightMap = new Map();
  let activeSearchId = -1;
  let activeResultIdx = -1;

  // Scrollbar drag state
  let thumbDragging = false;
  let thumbDragStartY = 0;
  let thumbDragStartRow = 0;

  // ---- File loading ----

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  loadFileBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => processText(e.target.result, file.name);
    reader.readAsText(file, 'UTF-8');
  }

  // ---- Text processing ----

  function isLetter(ch) { return /\p{Letter}/u.test(ch); }

  function stripToLetters(text) {
    const result = [];
    for (const char of text) {
      if (isLetter(char)) result.push(char);
    }
    return result;
  }

  function processText(raw, filename) {
    originalChars = stripToLetters(raw);
    cleanedText = originalChars.map(c => c.toUpperCase()).join('');

    fileInfoText.textContent = `${filename} \u2014 ${originalChars.length.toLocaleString()} letters`;
    addSearchBtn.disabled = false;

    dropZone.classList.add('hidden');
    gridContainer.style.display = 'block';

    // Clear all existing searches
    searches.forEach(s => { if (s.abort) s.abort.abort = true; });
    searches = [];
    activeSearchId = -1;
    activeResultIdx = -1;
    rebuildSearchCards();

    measureFont();
    setupGrid();

    // Auto-add the first search card
    addSearch();
  }

  // ---- Font measurement ----

  const FONT_SIZE = 14;
  const LINE_HEIGHT = 1.5;
  const FONT_FAMILY = "'Consolas', 'Courier New', 'Liberation Mono', monospace";

  function measureFont() {
    dpr = window.devicePixelRatio || 1;
    const tmpCanvas = document.createElement('canvas');
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    const metrics = tmpCtx.measureText('M');
    cellWidth = Math.ceil(metrics.width + 2);
    rowHeight = Math.ceil(FONT_SIZE * LINE_HEIGHT);
    baselineOffset = Math.ceil(FONT_SIZE * 1.15);
  }

  // ---- Grid setup ----

  function computeGridCols() {
    const areaWidth = gridArea.clientWidth - 24 - 12;
    return Math.max(1, Math.floor(areaWidth / cellWidth));
  }

  function setupGrid() {
    gridCols = computeGridCols();
    totalRows = Math.ceil(originalChars.length / gridCols);

    const viewW = gridContainer.clientWidth - 12;
    const viewH = gridContainer.clientHeight;
    visibleRows = viewH / rowHeight;
    maxScrollRow = Math.max(0, totalRows - visibleRows);

    scrollRow = Math.min(scrollRow, maxScrollRow);

    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    canvas.width = viewW * dpr;
    canvas.height = viewH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    updateScrollbar();
    scheduleRender();
  }

  // ---- Scroll helpers ----

  function setScrollRow(row) {
    scrollRow = Math.max(0, Math.min(row, maxScrollRow));
    updateScrollbar();
    scheduleRender();
  }

  // ---- Custom scrollbar ----

  function updateScrollbar() {
    if (totalRows <= 0) return;
    const trackH = scrollTrack.clientHeight;
    const thumbH = Math.max(24, (visibleRows / totalRows) * trackH);
    scrollThumb.style.height = thumbH + 'px';

    const scrollable = trackH - thumbH;
    const ratio = maxScrollRow > 0 ? scrollRow / maxScrollRow : 0;
    scrollThumb.style.top = (ratio * scrollable) + 'px';

    scrollTrack.style.display = totalRows <= visibleRows ? 'none' : '';
  }

  scrollThumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumbDragging = true;
    thumbDragStartY = e.clientY;
    thumbDragStartRow = scrollRow;
    scrollThumb.classList.add('dragging');
    scrollThumb.setPointerCapture(e.pointerId);
  });

  scrollThumb.addEventListener('pointermove', (e) => {
    if (!thumbDragging) return;
    const trackH = scrollTrack.clientHeight;
    const thumbH = scrollThumb.clientHeight;
    const scrollable = trackH - thumbH;
    if (scrollable <= 0) return;
    const dy = e.clientY - thumbDragStartY;
    setScrollRow(thumbDragStartRow + (dy / scrollable) * maxScrollRow);
  });

  scrollThumb.addEventListener('pointerup', () => {
    thumbDragging = false;
    scrollThumb.classList.remove('dragging');
  });

  scrollTrack.addEventListener('pointerdown', (e) => {
    if (e.target === scrollThumb) return;
    const trackRect = scrollTrack.getBoundingClientRect();
    const ratio = (e.clientY - trackRect.top) / trackRect.height;
    setScrollRow(ratio * maxScrollRow);
  });

  gridContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    setScrollRow(scrollRow + (e.deltaY / 100) * 3);
  }, { passive: false });

  gridContainer.setAttribute('tabindex', '0');
  gridContainer.style.outline = 'none';
  gridContainer.addEventListener('keydown', (e) => {
    const pageRows = Math.floor(visibleRows);
    switch (e.key) {
      case 'ArrowUp':    setScrollRow(scrollRow - 1); e.preventDefault(); break;
      case 'ArrowDown':  setScrollRow(scrollRow + 1); e.preventDefault(); break;
      case 'PageUp':     setScrollRow(scrollRow - pageRows); e.preventDefault(); break;
      case 'PageDown':   setScrollRow(scrollRow + pageRows); e.preventDefault(); break;
      case 'Home':       setScrollRow(0); e.preventDefault(); break;
      case 'End':        setScrollRow(maxScrollRow); e.preventDefault(); break;
    }
  });

  // ---- Multi-search management ----

  addSearchBtn.addEventListener('click', () => addSearch());

  function addSearch() {
    const id = nextSearchId++;
    const colorIdx = searches.length % COLORS.length;
    const search = {
      id,
      color: COLORS[colorIdx],
      colorIdx,
      term: '',
      minSkip: 2,
      maxSkip: 1000,
      results: [],
      abort: null,
      expanded: true,
      dom: {}
    };
    searches.push(search);
    buildCard(search);
    return search;
  }

  function removeSearch(id) {
    const idx = searches.findIndex(s => s.id === id);
    if (idx < 0) return;
    const search = searches[idx];
    if (search.abort) search.abort.abort = true;
    if (search.dom.card) search.dom.card.remove();
    searches.splice(idx, 1);

    if (activeSearchId === id) {
      activeSearchId = -1;
      activeResultIdx = -1;
    }

    rebuildHighlightMap();
    scheduleRender();
  }

  function buildCard(search) {
    const card = document.createElement('div');
    card.className = 'search-card expanded';

    // Header
    const header = document.createElement('div');
    header.className = 'search-card-header';

    const dot = document.createElement('div');
    dot.className = 'search-color-dot';
    dot.style.background = search.color.dot;

    const title = document.createElement('div');
    title.className = 'search-card-title';
    title.textContent = 'New search';

    const count = document.createElement('div');
    count.className = 'search-card-count';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'search-card-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove search';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSearch(search.id);
    });

    header.append(dot, title, count, removeBtn);
    header.addEventListener('click', () => {
      search.expanded = !search.expanded;
      card.classList.toggle('expanded', search.expanded);
    });

    // Body
    const body = document.createElement('div');
    body.className = 'search-card-body';

    const termLabel = document.createElement('label');
    termLabel.textContent = 'Search term';
    const termInput = document.createElement('input');
    termInput.type = 'text';
    termInput.placeholder = 'e.g. HELLO';
    termInput.autocomplete = 'off';

    const spacingRow = document.createElement('div');
    spacingRow.className = 'spacing-row';

    const minDiv = document.createElement('div');
    const minLabel = document.createElement('label');
    minLabel.textContent = 'Min spacing';
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.value = '2';
    minInput.min = '1';
    minDiv.append(minLabel, minInput);

    const maxDiv = document.createElement('div');
    const maxLabel = document.createElement('label');
    maxLabel.textContent = 'Max spacing';
    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.value = '1000';
    maxInput.min = '1';
    maxDiv.append(maxLabel, maxInput);

    spacingRow.append(minDiv, maxDiv);

    const searchButton = document.createElement('button');
    searchButton.className = 'card-search-btn';
    searchButton.textContent = 'Search';

    const progress = document.createElement('div');
    progress.className = 'card-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'card-progress-fill';
    progress.appendChild(progressFill);

    const status = document.createElement('div');
    status.className = 'card-status';

    const resultsList = document.createElement('ul');
    resultsList.className = 'search-card-results';

    body.append(termLabel, termInput, spacingRow, searchButton, progress, status, resultsList);

    card.append(header, body);

    // Insert before the add button
    searchesArea.insertBefore(card, addSearchBtn);

    // Store DOM refs
    search.dom = { card, title, count, termInput, minInput, maxInput, searchButton, progress, progressFill, status, resultsList };

    // Events
    searchButton.addEventListener('click', () => runSearch(search));
    termInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch(search);
    });

    // Focus the term input
    termInput.focus();
  }

  function rebuildSearchCards() {
    searchesArea.querySelectorAll('.search-card').forEach(c => c.remove());
  }

  // ---- Highlight map ----

  function rebuildHighlightMap() {
    highlightMap.clear();
    for (const search of searches) {
      for (const result of search.results) {
        for (const idx of result.indices) {
          highlightMap.set(idx, search.color);
        }
      }
    }
  }

  // ---- Search execution ----

  function runSearch(search) {
    const term = search.dom.termInput.value.trim();
    if (!term || !cleanedText) return;

    const needle = Array.from(term.toUpperCase()).filter(c => /\p{Letter}/u.test(c)).join('');
    if (needle.length < 2) {
      search.dom.status.textContent = 'Need at least 2 letters.';
      return;
    }

    const lo = Math.max(1, parseInt(search.dom.minInput.value) || 1);
    const hi = Math.min(cleanedText.length, parseInt(search.dom.maxInput.value) || 1000);
    if (lo > hi) {
      search.dom.status.textContent = 'Min spacing must be \u2264 max.';
      return;
    }

    if (search.abort) search.abort.abort = true;

    search.results = [];
    search.dom.resultsList.innerHTML = '';
    if (activeSearchId === search.id) {
      activeSearchId = -1;
      activeResultIdx = -1;
    }

    search.dom.searchButton.disabled = true;
    search.dom.progress.classList.add('visible');
    search.dom.progressFill.style.width = '0%';
    search.dom.status.textContent = 'Searching\u2026';

    search.dom.title.textContent = needle;
    search.term = needle;

    const abort = { abort: false };
    search.abort = abort;

    elsSearchAsync(cleanedText, needle, lo, hi, abort, (pct) => {
      search.dom.progressFill.style.width = pct + '%';
    }).then((results) => {
      if (abort.abort) return;
      search.abort = null;
      search.dom.searchButton.disabled = false;
      search.dom.progress.classList.remove('visible');

      search.results = results;
      search.dom.status.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
      search.dom.count.textContent = results.length > 0 ? `(${results.length})` : '';

      results.forEach((r, rIdx) => {
        const li = document.createElement('li');

        const wordDiv = document.createElement('div');
        wordDiv.className = 'result-word';
        wordDiv.style.color = search.color.text;
        wordDiv.textContent = r.display;
        li.appendChild(wordDiv);

        const detailDiv = document.createElement('div');
        detailDiv.className = 'result-detail';
        const direction = r.skip > 0 ? 'forward' : 'reverse';
        detailDiv.textContent = `Skip: ${Math.abs(r.skip)} | Pos: ${r.indices[0]} | ${direction}`;
        li.appendChild(detailDiv);

        li.addEventListener('click', () => selectResult(search.id, rIdx));
        search.dom.resultsList.appendChild(li);
      });

      rebuildHighlightMap();
      scheduleRender();
    });
  }

  // ---- ELS search algorithm ----

  function elsSearchAsync(text, needle, minS, maxS, abort, onProgress) {
    return new Promise((resolve) => {
      const results = [];
      const needleLen = needle.length;
      const textLen = text.length;
      const needleChars = Array.from(needle);

      let currentSkip = minS;
      const totalSkips = (maxS - minS + 1) * 2;
      let processed = 0;

      function chunk() {
        if (abort.abort) { resolve([]); return; }

        const chunkSize = 50;
        let count = 0;

        while (currentSkip <= maxS && count < chunkSize) {
          searchWithSkip(text, textLen, needleChars, needleLen, currentSkip, results);
          searchWithSkip(text, textLen, needleChars, needleLen, -currentSkip, results);
          currentSkip++;
          count++;
          processed += 2;
        }

        onProgress(Math.min(100, (processed / totalSkips) * 100));

        if (currentSkip > maxS) {
          results.sort((a, b) => Math.abs(a.skip) - Math.abs(b.skip));
          resolve(results);
        } else {
          requestAnimationFrame(chunk);
        }
      }

      requestAnimationFrame(chunk);
    });
  }

  function searchWithSkip(text, textLen, needleChars, needleLen, skip, results) {
    const absSkip = Math.abs(skip);
    const span = (needleLen - 1) * absSkip;

    let startFrom, startTo;
    if (skip > 0) {
      startFrom = 0;
      startTo = textLen - span;
    } else {
      startFrom = span;
      startTo = textLen;
    }

    for (let i = startFrom; i < startTo; i++) {
      let found = true;
      for (let j = 0; j < needleLen; j++) {
        if (text[i + j * skip] !== needleChars[j]) {
          found = false;
          break;
        }
      }
      if (found) {
        const indices = [];
        for (let j = 0; j < needleLen; j++) {
          indices.push(i + j * skip);
        }
        results.push({
          skip: skip,
          indices: indices,
          display: needleChars.join('')
        });
      }
    }
  }

  // ---- Result selection ----

  function selectResult(searchId, resultIdx) {
    // Deselect previous
    if (activeSearchId >= 0) {
      const prevSearch = searches.find(s => s.id === activeSearchId);
      if (prevSearch) {
        const prevLis = prevSearch.dom.resultsList.querySelectorAll('li');
        prevLis.forEach(li => li.classList.remove('active'));
      }
    }

    // If clicking the same result, deselect
    if (activeSearchId === searchId && activeResultIdx === resultIdx) {
      activeSearchId = -1;
      activeResultIdx = -1;
      scheduleRender();
      return;
    }

    activeSearchId = searchId;
    activeResultIdx = resultIdx;

    const search = searches.find(s => s.id === searchId);
    if (!search) return;

    const lis = search.dom.resultsList.querySelectorAll('li');
    if (lis[resultIdx]) lis[resultIdx].classList.add('active');

    scrollToResult(search.results[resultIdx]);
  }

  function scrollToResult(result) {
    const minIdx = Math.min(...result.indices);
    const maxIdx = Math.max(...result.indices);
    const firstRow = Math.floor(minIdx / gridCols);
    const lastRow = Math.floor(maxIdx / gridCols);
    const midRow = (firstRow + lastRow) / 2;
    setScrollRow(midRow - visibleRows / 2);
  }

  // ---- Rendering ----

  function scheduleRender() {
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(renderFrame);
    }
  }

  function drawResultOverlay(result, color, lineWidth, lineAlpha, rectAlpha, scrollPx, viewH) {
    const points = result.indices.map(idx => {
      const row = Math.floor(idx / gridCols);
      const col = idx % gridCols;
      return {
        x: col * cellWidth + cellWidth / 2,
        y: row * rowHeight + rowHeight / 2 - scrollPx
      };
    });

    if (points.length < 2) return;

    const hw = cellWidth / 2;
    const hh = rowHeight / 2;

    // Draw connecting lines clipped to rectangle edges
    ctx.globalAlpha = lineAlpha;
    ctx.strokeStyle = color.line;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([4, 3]);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx === 0 && dy === 0) continue;

      const tStart = Math.min(
        dx !== 0 ? hw / Math.abs(dx) : Infinity,
        dy !== 0 ? hh / Math.abs(dy) : Infinity
      );
      const tEnd = Math.min(
        dx !== 0 ? hw / Math.abs(dx) : Infinity,
        dy !== 0 ? hh / Math.abs(dy) : Infinity
      );

      ctx.beginPath();
      ctx.moveTo(a.x + dx * tStart, a.y + dy * tStart);
      ctx.lineTo(b.x - dx * tEnd, b.y - dy * tEnd);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw rectangles on top
    ctx.globalAlpha = rectAlpha;
    ctx.strokeStyle = color.dot;
    ctx.lineWidth = 1.5;
    for (const p of points) {
      if (p.y >= -rowHeight && p.y <= viewH + rowHeight) {
        ctx.strokeRect(
          p.x - hw + 0.5,
          p.y - hh + 0.5,
          cellWidth - 1,
          rowHeight - 1
        );
      }
    }

    ctx.globalAlpha = 1;
  }

  function drawAllResults(scrollPx, viewH) {
    // Draw inactive results first (dimmed)
    for (const search of searches) {
      for (let rIdx = 0; rIdx < search.results.length; rIdx++) {
        if (search.id === activeSearchId && rIdx === activeResultIdx) continue;
        drawResultOverlay(search.results[rIdx], search.color, 1, 0.25, 0.35, scrollPx, viewH);
      }
    }

    // Draw active result on top (full intensity)
    if (activeSearchId >= 0) {
      const search = searches.find(s => s.id === activeSearchId);
      if (search && search.results[activeResultIdx]) {
        drawResultOverlay(search.results[activeResultIdx], search.color, 2, 0.7, 1, scrollPx, viewH);
      }
    }
  }

  function renderFrame() {
    renderScheduled = false;

    const viewW = parseFloat(canvas.style.width);
    const viewH = parseFloat(canvas.style.height);
    const scrollPx = scrollRow * rowHeight;

    let firstRow = Math.floor(scrollRow);
    let lastRow = Math.ceil(scrollRow + visibleRows);
    firstRow = Math.max(0, firstRow);
    lastRow = Math.min(totalRows - 1, lastRow);

    const hasHighlight = highlightMap.size > 0;
    const gridTextColor = getGridTextColor();
    const bgColor = getBgColor();

    // Fill background (needed for light mode)
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, viewW, viewH);

    // Draw text
    ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'alphabetic';

    for (let row = firstRow; row <= lastRow; row++) {
      const y = row * rowHeight - scrollPx + baselineOffset;
      const rowStart = row * gridCols;
      const rowEnd = Math.min(rowStart + gridCols, originalChars.length);

      for (let i = rowStart; i < rowEnd; i++) {
        const col = i - rowStart;
        const x = col * cellWidth;
        const hlColor = hasHighlight ? highlightMap.get(i) : undefined;

        if (hlColor) {
          const bgY = row * rowHeight - scrollPx;
          ctx.fillStyle = hlColor.bg;
          ctx.fillRect(x, bgY, cellWidth, rowHeight);
          ctx.fillStyle = hlColor.text;
          ctx.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
          ctx.fillText(originalChars[i], x, y);
          ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
        } else {
          ctx.fillStyle = gridTextColor;
          ctx.fillText(originalChars[i], x, y);
        }
      }
    }

    // Draw connecting lines and rectangles for all results
    drawAllResults(scrollPx, viewH);
  }

  // Re-layout on resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (originalChars.length > 0) {
        measureFont();
        setupGrid();
      }
    }, 200);
  });

})();

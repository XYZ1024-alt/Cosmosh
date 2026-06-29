const mirrorExpression = `(() => {
  const mirror = window.__COSMOSH_BACKEND_REQUEST_TRACE__;
  if (!mirror) {
    return { enabled: false, updatedAt: null, traces: [] };
  }
  return {
    enabled: Boolean(mirror.enabled),
    updatedAt: mirror.updatedAt ?? null,
    traces: Array.isArray(mirror.traces) ? mirror.traces : [],
  };
})()`;

const refreshExpression = `(() => {
  const mirror = window.__COSMOSH_BACKEND_REQUEST_TRACE__;
  if (!mirror || typeof mirror.refresh !== 'function') {
    return false;
  }
  void mirror.refresh();
  return true;
})()`;

const clearExpression = `(() => {
  const mirror = window.__COSMOSH_BACKEND_REQUEST_TRACE__;
  if (!mirror || typeof mirror.clear !== 'function') {
    return false;
  }
  void mirror.clear();
  return true;
})()`;

const state = {
  traces: [],
  enabled: false,
  updatedAt: null,
  selectedId: null,
  activeTab: 'headers',
  filterText: '',
  sortMode: 'startedAtDesc',
};

const elements = {
  filterInput: document.getElementById('filterInput'),
  sortSelect: document.getElementById('sortSelect'),
  refreshButton: document.getElementById('refreshButton'),
  clearButton: document.getElementById('clearButton'),
  requestRows: document.getElementById('requestRows'),
  emptyState: document.getElementById('emptyState'),
  countText: document.getElementById('countText'),
  mirrorStatus: document.getElementById('mirrorStatus'),
  detailTitle: document.getElementById('detailTitle'),
  detailSubtitle: document.getElementById('detailSubtitle'),
  detailStatus: document.getElementById('detailStatus'),
  detailBody: document.getElementById('detailBody'),
  tabs: Array.from(document.querySelectorAll('.tab')),
};

const evalInInspectedWindow = (expression, callback) => {
  chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
    if (exceptionInfo?.isException) {
      callback(null);
      return;
    }
    callback(result);
  });
};

const requestRefresh = () => {
  evalInInspectedWindow(refreshExpression, () => {
    window.setTimeout(loadMirrorSnapshot, 120);
  });
};

const requestClear = () => {
  evalInInspectedWindow(clearExpression, () => {
    state.traces = [];
    state.selectedId = null;
    render();
    window.setTimeout(loadMirrorSnapshot, 120);
  });
};

const loadMirrorSnapshot = () => {
  evalInInspectedWindow(mirrorExpression, (snapshot) => {
    if (!snapshot || !Array.isArray(snapshot.traces)) {
      state.enabled = false;
      state.updatedAt = null;
      state.traces = [];
      syncSelection(getVisibleTraces());
      render();
      return;
    }

    state.enabled = Boolean(snapshot.enabled);
    state.updatedAt = typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : null;
    state.traces = snapshot.traces.slice();
    syncSelection(getVisibleTraces());
    render();
  });
};

const render = () => {
  const visibleTraces = getVisibleTraces();
  syncSelection(visibleTraces);
  elements.requestRows.replaceChildren(...visibleTraces.map(createRequestRow));
  elements.emptyState.classList.toggle('is-visible', visibleTraces.length === 0);
  elements.countText.textContent = `${visibleTraces.length} of ${state.traces.length} requests`;
  elements.mirrorStatus.textContent = state.enabled ? 'mirror on' : 'mirror off';
  elements.mirrorStatus.className = `mirror-status${state.enabled ? ' is-on' : ' is-off'}`;
  renderDetails();
};

const syncSelection = (visibleTraces) => {
  if (state.selectedId && visibleTraces.some((trace) => trace.id === state.selectedId)) {
    return;
  }

  state.selectedId = visibleTraces[0]?.id ?? null;
};

const getVisibleTraces = () => {
  const query = state.filterText.trim().toLowerCase();
  const filtered = query
    ? state.traces.filter((trace) => {
        return [trace.method, trace.path, trace.status, trace.requestId, trace.error]
          .filter((value) => value !== undefined && value !== null)
          .some((value) => String(value).toLowerCase().includes(query));
      })
    : state.traces.slice();

  return sortTraces(filtered, state.sortMode);
};

const sortTraces = (traces, sortMode) => {
  const sorted = traces.slice();
  sorted.sort((left, right) => {
    if (sortMode === 'startedAtAsc') {
      return compareTime(left.startedAt, right.startedAt);
    }
    if (sortMode === 'durationDesc') {
      return compareNumber(right.durationMs, left.durationMs);
    }
    if (sortMode === 'durationAsc') {
      return compareNumber(left.durationMs, right.durationMs);
    }
    if (sortMode === 'statusAsc') {
      return compareNumber(left.status ?? Number.MAX_SAFE_INTEGER, right.status ?? Number.MAX_SAFE_INTEGER);
    }
    if (sortMode === 'methodAsc') {
      return compareText(left.method, right.method) || compareTime(right.startedAt, left.startedAt);
    }
    if (sortMode === 'pathAsc') {
      return compareText(left.path, right.path) || compareTime(right.startedAt, left.startedAt);
    }
    return compareTime(right.startedAt, left.startedAt);
  });
  return sorted;
};

const compareTime = (left, right) => {
  return new Date(left).getTime() - new Date(right).getTime();
};

const compareNumber = (left, right) => {
  return left - right;
};

const compareText = (left, right) => {
  return String(left ?? '').localeCompare(String(right ?? ''));
};

const createRequestRow = (trace) => {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `request-row${trace.id === state.selectedId ? ' is-active' : ''}`;
  row.addEventListener('click', () => {
    state.selectedId = trace.id;
    render();
  });

  row.appendChild(createCell('cell-method', trace.method));
  row.appendChild(createCell('cell-path', trace.path));
  row.appendChild(createStatusCell(trace));
  row.appendChild(createCell('cell-time', `${Math.round(trace.durationMs)} ms`));
  row.appendChild(createCell('cell-started', formatClockTime(trace.startedAt)));
  return row;
};

const createCell = (className, text) => {
  const cell = document.createElement('span');
  cell.className = className;
  cell.textContent = text ?? '';
  cell.title = text ?? '';
  return cell;
};

const createStatusCell = (trace) => {
  const text = trace.status === null ? 'ERR' : String(trace.status);
  const statusClass = trace.ok === true ? 'is-ok' : trace.ok === false ? 'is-error' : 'is-warn';
  return createCell(`cell-status ${statusClass}`, text);
};

const renderDetails = () => {
  const visibleTraces = getVisibleTraces();
  const trace = visibleTraces.find((item) => item.id === state.selectedId) ?? null;
  if (!trace) {
    elements.detailTitle.textContent = 'Select a request';
    elements.detailSubtitle.textContent = state.enabled ? 'Backend proxy mirror' : 'Trace mirror unavailable';
    elements.detailStatus.textContent = state.enabled ? 'ready' : 'off';
    elements.detailStatus.className = 'status-pill';
    elements.detailBody.textContent = 'No request selected.';
    return;
  }

  elements.detailTitle.textContent = `${trace.method} ${trace.path}`;
  elements.detailSubtitle.textContent = trace.requestId
    ? `requestId ${trace.requestId}`
    : 'Mirrored backend proxy request';
  elements.detailStatus.textContent = trace.status === null ? 'error' : String(trace.status);
  elements.detailStatus.className = `status-pill${trace.ok ? ' is-ok' : ' is-error'}`;
  elements.detailBody.textContent = formatDetail(trace, state.activeTab);
};

const formatDetail = (trace, tab) => {
  if (tab === 'headers') {
    return formatHeaders(trace);
  }
  if (tab === 'payload') {
    return formatBody(trace.requestBody);
  }
  if (tab === 'response') {
    return [formatBody(trace.responseBody), trace.error ? `\nError:\n${trace.error}` : ''].join('');
  }
  return formatTiming(trace);
};

const formatHeaders = (trace) => {
  return [
    `Method: ${trace.method}`,
    `Path: ${trace.path}`,
    `Status: ${trace.status ?? 'transport error'}`,
    `Request ID: ${trace.requestId ?? 'n/a'}`,
    'x-cosmosh-internal-token: not mirrored',
  ].join('\n');
};

const formatBody = (body) => {
  if (!body || body.kind === 'empty') {
    return 'Body: empty';
  }

  const metadata = [
    `Kind: ${body.kind}`,
    `Size: ${body.sizeBytes} bytes`,
    `Truncated: ${body.truncated ? 'yes' : 'no'}`,
  ].join('\n');
  return `${metadata}\n\n${formatBodyValue(body.value)}`;
};

const formatBodyValue = (value) => {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatTiming = (trace) => {
  return [
    `Started: ${trace.startedAt}`,
    `Completed: ${trace.completedAt}`,
    `Duration: ${Math.round(trace.durationMs)} ms`,
    `Updated: ${state.updatedAt ?? 'n/a'}`,
  ].join('\n');
};

const formatClockTime = (isoValue) => {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

elements.filterInput.addEventListener('input', (event) => {
  state.filterText = event.target.value;
  render();
});

elements.sortSelect.addEventListener('change', (event) => {
  state.sortMode = event.target.value;
  render();
});

elements.refreshButton.addEventListener('click', requestRefresh);
elements.clearButton.addEventListener('click', requestClear);
elements.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.activeTab = tab.dataset.tab;
    elements.tabs.forEach((item) => item.classList.toggle('is-active', item === tab));
    renderDetails();
  });
});

loadMirrorSnapshot();
window.setInterval(loadMirrorSnapshot, 1000);
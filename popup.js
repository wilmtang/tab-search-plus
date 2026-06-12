(function () {
  const OPEN_COMMAND = "_execute_browser_action";
  const RECENTLY_CLOSED_LIMIT = 25;
  const RECENTLY_CLOSED_DISPLAY_LIMIT = 8;
  const POPUP_MAX_WIDTH = 800;
  const POPUP_MIN_WIDTH = 280;
  const POPUP_DEFAULT_WIDTH = 320;
  const POPUP_MAX_HEIGHT = 600;
  const POPUP_VERTICAL_MARGIN = 96;
  const POPUP_MIN_HEIGHT = 420;
  const POPUP_MIN_SCALE = 0.85;
  const POPUP_MAX_SCALE = 1.3;
  const POPUP_DEFAULT_SCALE = 1;
  const NO_GROUP = -1;
  const api = typeof browser === "undefined" ? null : browser;
  const isMock = !api || new URLSearchParams(location.search).has("mock");
  const popupSettingsDefaults = {
    popupWidth: POPUP_DEFAULT_WIDTH,
    popupFontScale: POPUP_DEFAULT_SCALE
  };

  const groupColorMap = {
    grey: "#9aa0a6",
    gray: "#9aa0a6",
    blue: "#8ab4f8",
    red: "#f28b82",
    yellow: "#fdd663",
    green: "#81c995",
    pink: "#ff8bcb",
    purple: "#c58af9",
    cyan: "#78d7ff",
    orange: "#fcad70"
  };
  const searchFields = [
    { key: "title", weight: 2 },
    { key: "hostname", weight: 1 },
    { key: "groupName", weight: 1.5 }
  ];

  const state = {
    query: "",
    openTabs: [],
    closedItems: [],
    visibleItems: [],
    selectedId: "",
    recentlyClosedExpanded: true,
    currentWindowId: null,
    popupWidth: POPUP_DEFAULT_WIDTH,
    popupFontScale: POPUP_DEFAULT_SCALE
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    els.input = document.getElementById("search-input");
    els.shortcut = document.getElementById("shortcut-hint");
    els.results = document.getElementById("results");

    bindEvents();
    scheduleSearchFocus();

    await loadPopupSettings();
    syncPopupMaxHeight();
    window.addEventListener("resize", syncPopupMaxHeight);
    window.visualViewport?.addEventListener("resize", syncPopupMaxHeight);

    await loadPopupState();
    await loadShortcutHint();
    await refreshData();
    scheduleSearchFocus();
  }

  function bindEvents() {
    els.input.addEventListener("input", () => {
      state.query = els.input.value.trim();
      render();
    });

    els.input.addEventListener("keydown", handleSearchKeyDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    els.results.addEventListener("click", async (event) => {
      const closeButton = event.target.closest("[data-close-tab]");
      if (closeButton) {
        event.preventDefault();
        event.stopPropagation();
        const item = findVisibleItem(closeButton.dataset.closeTab);
        if (item) await closeOpenTab(item);
        return;
      }

      const sectionToggle = event.target.closest("[data-toggle-recent]");
      if (sectionToggle) {
        state.recentlyClosedExpanded = !state.recentlyClosedExpanded;
        await savePopupState();
        render();
        return;
      }

      const row = event.target.closest("[data-item-id]");
      if (!row) return;
      const item = findVisibleItem(row.dataset.itemId);
      if (!item) return;
      state.selectedId = item.id;
      renderSelection();
      await activateItem(item);
    });

    if (!isMock && api.tabs) {
      const scheduleRefresh = debounce(refreshData, 120);
      api.tabs.onCreated.addListener(scheduleRefresh);
      api.tabs.onRemoved.addListener(scheduleRefresh);
      api.tabs.onUpdated.addListener(scheduleRefresh);
      api.tabs.onActivated.addListener(scheduleRefresh);
      api.tabs.onMoved.addListener(scheduleRefresh);
      api.sessions?.onChanged?.addListener(scheduleRefresh);
      api.tabGroups?.onCreated?.addListener(scheduleRefresh);
      api.tabGroups?.onUpdated?.addListener(scheduleRefresh);
      api.tabGroups?.onRemoved?.addListener(scheduleRefresh);
      api.tabGroups?.onMoved?.addListener(scheduleRefresh);
    }
  }

  async function handleSearchKeyDown(event) {
    if (event.isComposing) return;

    const navigationDirection = getNavigationDirection(event);
    if (navigationDirection !== 0) {
      event.preventDefault();
      moveSelection(navigationDirection);
    } else if (event.key === "Enter") {
      event.preventDefault();
      await activateSelected();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePopup();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      const selected = getSelectedItem();
      if (selected && selected.type === "open" && els.input.value === "") {
        event.preventDefault();
        await closeOpenTab(selected);
      }
    }
  }

  async function handleDocumentKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.target === els.input || isEditableTarget(event.target)) return;

    const navigationDirection = getNavigationDirection(event);
    if (navigationDirection !== 0) {
      event.preventDefault();
      moveSelection(navigationDirection);
      focusSearchInput();
      return;
    }

    if (event.key.length === 1 && !hasCommandModifier(event)) {
      if (!isInteractiveTarget(event.target)) focusSearchInput();
      return;
    }

    if (hasCommandModifier(event)) return;

    if (event.key === "Enter" && !isInteractiveTarget(event.target)) {
      event.preventDefault();
      await activateSelected();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePopup();
    }
  }

  function getNavigationDirection(event) {
    if (event.key === "ArrowDown") return 1;
    if (event.key === "ArrowUp") return -1;

    if (!isMac() || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return 0;

    const key = event.key.toLocaleLowerCase();
    if (key === "n") return 1;
    if (key === "p") return -1;
    return 0;
  }

  function scheduleSearchFocus() {
    focusSearchInput();
    requestAnimationFrame(focusSearchInput);
    setTimeout(focusSearchInput, 75);
  }

  function focusSearchInput() {
    if (!els.input) return;
    try {
      els.input.focus({ preventScroll: true });
    } catch {
      els.input.focus();
    }
  }

  function hasCommandModifier(event) {
    return event.altKey || event.ctrlKey || event.metaKey;
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  }

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, [role='button']"));
  }

  async function loadPopupState() {
    if (isMock || !api.storage) {
      state.recentlyClosedExpanded = localStorage.getItem("recentlyClosedExpanded") !== "false";
      return;
    }

    const stored = await api.storage.local.get({ recentlyClosedExpanded: true });
    state.recentlyClosedExpanded = stored.recentlyClosedExpanded !== false;
  }

  async function savePopupState() {
    if (isMock || !api.storage) {
      localStorage.setItem("recentlyClosedExpanded", String(state.recentlyClosedExpanded));
      return;
    }

    await api.storage.local.set({ recentlyClosedExpanded: state.recentlyClosedExpanded });
  }

  async function loadPopupSettings() {
    const stored = await getStoredPopupSettings();
    state.popupWidth = clampNumber(stored.popupWidth, POPUP_MIN_WIDTH, POPUP_MAX_WIDTH, POPUP_DEFAULT_WIDTH);
    state.popupFontScale = clampNumber(stored.popupFontScale, POPUP_MIN_SCALE, POPUP_MAX_SCALE, POPUP_DEFAULT_SCALE);
    applyPopupSettings();
  }

  async function getStoredPopupSettings() {
    if (isMock || !api.storage) {
      return {
        popupWidth: readLocalSetting("popupWidth", POPUP_DEFAULT_WIDTH),
        popupFontScale: readLocalSetting("popupFontScale", POPUP_DEFAULT_SCALE)
      };
    }

    return api.storage.local.get(popupSettingsDefaults);
  }

  function applyPopupSettings() {
    const root = document.documentElement;
    root.style.setProperty("--popup-width", `${state.popupWidth}px`);
    root.style.setProperty("--popup-scale", String(state.popupFontScale));
  }

  async function loadShortcutHint() {
    const fallback = isMac() ? "⌘⌃A" : "Ctrl Alt A";
    if (isMock || !api.commands) {
      els.shortcut.textContent = fallback;
      return;
    }

    try {
      const commands = await api.commands.getAll();
      const command = commands.find((entry) => entry.name === OPEN_COMMAND);
      els.shortcut.textContent = formatShortcutForHeader(command?.shortcut || fallback);
    } catch {
      els.shortcut.textContent = fallback;
    }
  }

  async function refreshData() {
    els.results.setAttribute("aria-busy", "true");

    if (isMock) {
      const mock = getMockData();
      state.currentWindowId = 1;
      state.openTabs = mock.openTabs;
      state.closedItems = mock.closedItems;
      render();
      els.results.removeAttribute("aria-busy");
      return;
    }

    try {
      const [windows, recentlyClosed] = await Promise.all([
        api.windows.getAll({ populate: true, windowTypes: ["normal"] }),
        api.sessions.getRecentlyClosed({ maxResults: RECENTLY_CLOSED_LIMIT }).catch(() => [])
      ]);

      const focusedWindow = windows.find((windowInfo) => windowInfo.focused) || windows[0];
      state.currentWindowId = focusedWindow?.id ?? null;

      const openTabs = windows.flatMap((windowInfo) => {
        return (windowInfo.tabs || []).map((tab) => ({
          ...tab,
          windowFocused: Boolean(windowInfo.focused),
          windowTitle: windowInfo.title || ""
        }));
      });

      const groups = await getGroupMap(openTabs);

      const normalizedOpenTabs = openTabs
        .map((tab) => normalizeOpenTab(tab, groups.get(tab.groupId)))
        .sort(sortOpenTabs);
      state.openTabs = normalizedOpenTabs;
      state.closedItems = normalizeClosedSessions(recentlyClosed, normalizedOpenTabs);

      render();
    } catch (error) {
      renderError(error);
    } finally {
      els.results.removeAttribute("aria-busy");
    }
  }

  async function getGroupMap(tabs) {
    const groupMap = new Map();
    if (!api.tabGroups?.get) return groupMap;

    const ids = [...new Set(tabs.map((tab) => tab.groupId).filter((id) => id !== undefined && id !== NO_GROUP))];
    await Promise.all(ids.map(async (id) => {
      try {
        const group = await api.tabGroups.get(id);
        groupMap.set(id, group);
      } catch {
        groupMap.set(id, { id, title: "", color: "grey" });
      }
    }));

    return groupMap;
  }

  function normalizeOpenTab(tab, group) {
    const title = tab.title || displayUrl(tab.url) || "Untitled";
    const url = tab.url || "";
    const hostname = displayUrl(url);
    const groupName = group?.title || "";
    const groupColor = groupColorMap[group?.color] || groupColorMap.grey;

    return {
      id: `open-${tab.id}`,
      type: "open",
      tabId: tab.id,
      windowId: tab.windowId,
      active: Boolean(tab.active),
      pinned: Boolean(tab.pinned),
      audible: Boolean(tab.audible),
      muted: Boolean(tab.mutedInfo?.muted),
      title,
      url,
      hostname,
      displayUrl: hostname,
      favIconUrl: tab.favIconUrl || "",
      lastTime: tab.lastAccessed || Date.now(),
      hasGroup: tab.groupId !== undefined && tab.groupId !== NO_GROUP,
      groupName,
      groupColor,
      groupId: tab.groupId,
      windowFocused: Boolean(tab.windowFocused)
    };
  }

  function normalizeClosedSessions(sessions, openTabs = []) {
    const items = [];
    const seenUrls = new Set(openTabs.map((tab) => normalizeUrlKey(tab.url)).filter(Boolean));

    sessions.forEach((session, index) => {
      if (session.tab) {
        const tab = session.tab;
        appendClosedTab(items, seenUrls, tab, session.lastModified, tab.sessionId, index);
      } else if (session.window) {
        const sessionWindow = session.window;
        const tabs = sessionWindow.tabs || [];
        tabs.forEach((tab, tabIndex) => {
          appendClosedTab(items, seenUrls, tab, session.lastModified, tab.sessionId, `${index}-${tabIndex}`);
        });
      }
    });

    return items.sort((a, b) => b.lastTime - a.lastTime);
  }

  function appendClosedTab(items, seenUrls, tab, lastModified, sessionId, index) {
    if (!tab || !isRestorableClosedUrl(tab.url)) return;

    const urlKey = normalizeUrlKey(tab.url);
    if (!urlKey || seenUrls.has(urlKey)) return;

    seenUrls.add(urlKey);
    items.push(normalizeClosedTab(tab, lastModified, sessionId, index));
  }

  function normalizeClosedTab(tab, lastModified, sessionId, index) {
    const title = tab.title || displayUrl(tab.url) || "Untitled";
    const url = tab.url || "";
    const hostname = displayUrl(url);

    return {
      id: `closed-${sessionId || index}`,
      type: "closed",
      restoreType: "tab",
      sessionId,
      title,
      url,
      hostname,
      displayUrl: hostname,
      favIconUrl: tab.favIconUrl || "",
      lastTime: lastModified || Date.now()
    };
  }

  function sortOpenTabs(a, b) {
    const aCurrent = a.active && a.windowFocused;
    const bCurrent = b.active && b.windowFocused;
    if (aCurrent !== bCurrent) return aCurrent ? 1 : -1;
    if (a.lastTime !== b.lastTime) return b.lastTime - a.lastTime;
    return a.title.localeCompare(b.title);
  }

  function render() {
    const query = state.query.trim();
    const isSearching = query !== "";
    const openMatches = searchItems(query, state.openTabs);
    const closedMatches = searchItems(query, state.closedItems);
    const mediaItems = isSearching ? [] : openMatches.filter(isMediaItem);
    const openItems = isSearching ? openMatches : openMatches.filter((item) => !isMediaItem(item));
    const closedItems = isSearching ? closedMatches : closedMatches.slice(0, RECENTLY_CLOSED_DISPLAY_LIMIT);
    const visibleOpenItems = isSearching ? openItems : [...mediaItems, ...openItems];
    const visible = [...visibleOpenItems, ...(state.recentlyClosedExpanded ? closedItems : [])];

    if (!visible.some((item) => item.id === state.selectedId)) {
      state.selectedId = getDefaultSelectedId(openMatches, visible);
    }

    state.visibleItems = visible;
    els.results.textContent = "";

    if (mediaItems.length > 0) {
      els.results.appendChild(createSection("Audio & Video", mediaItems));
    }

    if (openItems.length > 0) {
      els.results.appendChild(createSection("Open Tabs", openItems));
    }

    if (closedItems.length > 0) {
      els.results.appendChild(createClosedSection(closedItems));
    }

    if (openMatches.length === 0 && closedMatches.length === 0) {
      els.results.appendChild(createEmptyState("No Results Found"));
    }

    renderSelection();
  }

  function isMediaItem(item) {
    return item.type === "open" && (item.audible || item.muted);
  }

  function getDefaultSelectedId(openItems, visibleItems) {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const firstOpenItem = openItems.find((item) => visibleIds.has(item.id));
    return firstOpenItem?.id || visibleItems[0]?.id || "";
  }

  function createSection(title, items) {
    const section = document.createElement("section");
    section.className = "section";

    const heading = document.createElement("div");
    heading.className = "section-title";
    heading.textContent = title;
    section.appendChild(heading);

    const rows = document.createElement("div");
    rows.className = "rows";
    items.forEach((item) => rows.appendChild(createRow(item)));
    section.appendChild(rows);

    return section;
  }

  function createClosedSection(items) {
    const section = document.createElement("section");
    section.className = "section";

    const heading = document.createElement("button");
    heading.className = "section-title";
    heading.type = "button";
    heading.dataset.toggleRecent = "true";

    const text = document.createElement("span");
    text.textContent = "Recently Closed";
    heading.appendChild(text);

    const icon = createChevronIcon();
    if (!state.recentlyClosedExpanded) icon.classList.add("is-collapsed");
    heading.appendChild(icon);
    section.appendChild(heading);

    if (state.recentlyClosedExpanded) {
      const rows = document.createElement("div");
      rows.className = "rows";
      items.forEach((item) => rows.appendChild(createRow(item)));
      section.appendChild(rows);
    }

    return section;
  }

  function createRow(item) {
    const row = document.createElement("button");
    row.className = "tab-row";
    row.type = "button";
    row.id = item.id;
    row.dataset.itemId = item.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", item.id === state.selectedId ? "true" : "false");

    row.appendChild(createFavicon(item));

    const copy = document.createElement("div");
    copy.className = "tab-copy";

    const title = document.createElement("div");
    title.className = "tab-title";

    const titleText = document.createElement("span");
    titleText.className = "tab-title-text";
    appendHighlightedText(titleText, item.title, item.highlightRanges?.title);
    title.appendChild(titleText);

    if (isMediaItem(item)) {
      title.appendChild(createMediaIndicatorIcon(item.muted));
    }

    copy.appendChild(title);

    copy.appendChild(createMeta(item));
    row.appendChild(copy);

    if (item.type === "open") {
      row.appendChild(createCloseButton(item));
    } else {
      const spacer = document.createElement("span");
      spacer.className = "row-spacer";
      row.appendChild(spacer);
    }

    return row;
  }

  function createFavicon(item) {
    const shell = document.createElement("span");
    shell.className = "favicon-shell";
    const fallback = createFallbackIcon(item.type === "closed");

    if (item.favIconUrl) {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.loading = "lazy";
      img.src = item.favIconUrl;
      fallback.classList.add("is-hidden");
      img.addEventListener("error", () => {
        img.classList.add("is-hidden");
        fallback.classList.remove("is-hidden");
      });
      shell.appendChild(img);
    }

    shell.appendChild(fallback);
    return shell;
  }

  function createMeta(item) {
    const meta = document.createElement("div");
    meta.className = "tab-meta";

    if (item.pinned) {
      meta.appendChild(createPinIcon());
    }

    if (item.hasGroup || item.groupName) {
      const chip = document.createElement("span");
      chip.className = "group-chip";
      chip.style.setProperty("--group-color", item.groupColor);

      const dot = document.createElement("span");
      dot.className = "group-dot";
      chip.appendChild(dot);

      if (item.groupName) {
        const name = document.createElement("span");
        name.className = "group-name";
        appendHighlightedText(name, item.groupName, item.highlightRanges?.groupName);
        chip.appendChild(name);
      }

      meta.appendChild(chip);
      meta.appendChild(createSeparator());
    }

    const url = document.createElement("span");
    url.className = "meta-text";
    appendHighlightedText(url, item.hostname || item.displayUrl || "Unknown", item.highlightRanges?.hostname);
    meta.appendChild(url);

    const time = formatTimeAgo(item.lastTime);
    if (time) {
      meta.appendChild(createSeparator());
      const timeNode = document.createElement("span");
      timeNode.className = "meta-text";
      timeNode.textContent = time;
      meta.appendChild(timeNode);
    }

    return meta;
  }

  function createCloseButton(item) {
    const button = document.createElement("button");
    button.className = "row-action";
    button.type = "button";
    button.title = "Close tab";
    button.setAttribute("aria-label", `Close ${item.title}`);
    button.tabIndex = -1;
    button.dataset.closeTab = item.id;
    button.appendChild(createCloseIcon());
    return button;
  }

  function appendHighlightedText(element, text, ranges = []) {
    const value = text || "";
    element.textContent = "";

    if (ranges.length === 0) {
      element.appendChild(document.createTextNode(value));
      return;
    }

    let cursor = 0;
    ranges
      .map((range) => ({
        start: clampNumber(range.start, 0, value.length, 0),
        end: clampNumber(range.end, 0, value.length, 0)
      }))
      .filter((range) => range.end > range.start)
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .forEach((range) => {
        if (range.start < cursor) return;
        if (range.start > cursor) {
          element.appendChild(document.createTextNode(value.slice(cursor, range.start)));
        }

        const hit = document.createElement("span");
        hit.className = "search-highlight-hit";
        hit.textContent = value.slice(range.start, range.end);
        element.appendChild(hit);
        cursor = range.end;
      });

    if (cursor < value.length) {
      element.appendChild(document.createTextNode(value.slice(cursor)));
    }
  }

  function createSeparator() {
    const separator = document.createElement("span");
    separator.className = "meta-separator";
    separator.textContent = "•";
    return separator;
  }

  function createEmptyState(message) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = message;
    return empty;
  }

  function renderSelection() {
    els.results.querySelectorAll("[data-item-id]").forEach((row) => {
      const selected = row.dataset.itemId === state.selectedId;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }

  function renderError(error) {
    els.results.textContent = "";
    const empty = createEmptyState(`Could not load tabs: ${error.message}`);
    els.results.appendChild(empty);
  }

  function moveSelection(direction) {
    if (state.visibleItems.length === 0) return;
    const currentIndex = Math.max(0, state.visibleItems.findIndex((item) => item.id === state.selectedId));
    const nextIndex = (currentIndex + direction + state.visibleItems.length) % state.visibleItems.length;
    state.selectedId = state.visibleItems[nextIndex].id;
    renderSelection();
    document.getElementById(state.selectedId)?.scrollIntoView({ block: "nearest" });
  }

  async function activateSelected() {
    const item = getSelectedItem();
    if (item) await activateItem(item);
  }

  async function activateItem(item) {
    if (item.type === "open") {
      if (!isMock) {
        await api.windows.update(item.windowId, { focused: true }).catch(() => {});
        await api.tabs.update(item.tabId, { active: true });
      }
      closePopup();
      return;
    }

    if (!isMock) {
      if (item.sessionId) {
        await api.sessions.restore(item.sessionId);
      } else if (item.url) {
        await api.tabs.create({ url: item.url });
      }
    }
    closePopup();
  }

  async function closeOpenTab(item) {
    if (!item || item.type !== "open") return;

    if (!isMock) {
      await api.tabs.remove(item.tabId);
      await refreshData();
      return;
    }

    state.openTabs = state.openTabs.filter((tab) => tab.id !== item.id);
    render();
  }

  function closePopup() {
    if (isMock) return;
    window.close();
  }

  function syncPopupMaxHeight() {
    const screenHeight = window.screen?.availHeight || window.screen?.height || window.innerHeight || 720;
    const maxHeight = Math.min(POPUP_MAX_HEIGHT, Math.max(POPUP_MIN_HEIGHT, screenHeight - POPUP_VERTICAL_MARGIN));
    document.documentElement.style.setProperty("--popup-max-height", `${Math.round(maxHeight)}px`);
  }

  function readLocalSetting(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;

    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function getSelectedItem() {
    return state.visibleItems.find((item) => item.id === state.selectedId);
  }

  function findVisibleItem(id) {
    return state.visibleItems.find((item) => item.id === id);
  }

  function searchItems(query, items) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return items.map((item) => ({
        ...item,
        highlightRanges: createEmptyHighlightRanges()
      }));
    }

    const normalizedQuery = normalizeSearchString(trimmedQuery);
    const matches = items
      .map((item, index) => {
        const highlightRanges = createEmptyHighlightRanges();
        let score = 0;
        let hasMatch = false;

        searchFields.forEach(({ key, weight }) => {
          const ranges = getRanges(item[key], normalizedQuery);
          highlightRanges[key] = ranges;
          if (ranges.length === 0) return;

          hasMatch = true;
          score += ranges.reduce((total, range) => {
            return total + Math.max((200 - range.start) / 200, 0) * weight;
          }, 0);
        });

        if (!hasMatch) return null;

        return {
          ...item,
          highlightRanges,
          searchScore: score,
          searchIndex: index
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.searchScore - a.searchScore || a.searchIndex - b.searchIndex);

    return prioritizeMatchResults(matches, normalizedQuery).map(({ searchScore, searchIndex, ...item }) => item);
  }

  function getRanges(text, normalizedQuery) {
    const value = normalizeSearchString(text || "");
    if (!value || !normalizedQuery) return [];

    const regex = new RegExp(escapeRegExp(normalizedQuery), "gi");
    const ranges = [];
    let match = regex.exec(value);
    while (match) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length
      });
      match = regex.exec(value);
    }

    return ranges;
  }

  function prioritizeMatchResults(items, normalizedQuery) {
    const prefixMatches = [];
    const wordBoundaryMatches = [];
    const otherMatches = [];

    items.forEach((item) => {
      if (hasPrefixMatch(item, normalizedQuery)) {
        prefixMatches.push(item);
      } else if (hasWordBoundaryMatch(item, normalizedQuery)) {
        wordBoundaryMatches.push(item);
      } else {
        otherMatches.push(item);
      }
    });

    return [...prefixMatches, ...wordBoundaryMatches, ...otherMatches];
  }

  function hasPrefixMatch(item, normalizedQuery) {
    return searchFields.some(({ key }) => normalizeSearchString(item[key] || "").startsWith(normalizedQuery));
  }

  function hasWordBoundaryMatch(item, normalizedQuery) {
    const regex = new RegExp(`\\b${escapeRegExp(normalizedQuery)}`, "i");
    return searchFields.some(({ key }) => regex.test(normalizeSearchString(item[key] || "")));
  }

  function createEmptyHighlightRanges() {
    return {
      title: [],
      hostname: [],
      groupName: []
    };
  }

  function normalizeSearchString(value) {
    return String(value)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, "\"");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeUrlKey(url) {
    if (!url) return "";

    try {
      return new URL(url).href;
    } catch {
      return "";
    }
  }

  function isRestorableClosedUrl(url) {
    const urlKey = normalizeUrlKey(url);
    if (!urlKey) return false;

    return !["about:newtab", "about:home", "about:blank"].includes(urlKey.replace(/\/$/, ""));
  }

  function displayUrl(url) {
    if (!url) return "";

    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.hostname.replace(/^www\./, "");
      }
      if (parsed.protocol === "file:") return parsed.pathname.split("/").filter(Boolean).pop() || "file";
      if (parsed.protocol === "moz-extension:") return "Extension";
      return url.replace(/\/$/, "");
    } catch {
      return url;
    }
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return "";
    const diff = Math.max(0, Date.now() - timestamp);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return "now";
    if (diff < hour) return `${Math.floor(diff / minute)} mins ago`;
    if (diff < day) {
      const hours = Math.floor(diff / hour);
      return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    }

    const days = Math.floor(diff / day);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }

  function formatShortcutForHeader(shortcut) {
    if (!shortcut) return "";
    const parts = shortcut.split("+");
    if (isMac()) {
      return parts.map((part) => {
        if (part === "Command") return "⌘";
        if (part === "MacCtrl") return "⌃";
        if (part === "Ctrl") return "⌘";
        if (part === "Alt") return "⌥";
        if (part === "Shift") return "⇧";
        return part;
      }).join("");
    }

    return parts.map((part) => part === "Alt" ? "Alt" : part).join(" ");
  }

  function isMac() {
    const platform = navigator.platform?.toLowerCase() || "";
    const userAgent = navigator.userAgent?.toLowerCase() || "";
    return platform.includes("mac") || userAgent.includes("mac");
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function createMediaIndicatorIcon(isMuted) {
    const svg = createSvg("0 0 24 24");
    svg.classList.add("media-alert-icon");
    appendPath(svg, "M4 9v6h4l5 4V5L8 9H4Z");

    if (isMuted) {
      appendPath(svg, "m17 9 4 4m0-4-4 4");
    } else {
      appendPath(svg, "M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12");
    }

    return svg;
  }

  function createCloseIcon() {
    const svg = createSvg("0 0 24 24");
    appendPath(svg, "M18 6 6 18M6 6l12 12");
    return svg;
  }

  function createChevronIcon() {
    const svg = createSvg("0 0 24 24");
    svg.classList.add("section-title-icon");
    appendPath(svg, "m6 9 6 6 6-6");
    return svg;
  }

  function createFallbackIcon(isClosed) {
    const svg = createSvg("0 0 24 24");
    svg.classList.add("fallback-icon");
    if (isClosed) {
      appendPath(svg, "M7 7h10v10H7zM9 7V5h6v2", true);
      return svg;
    }

    appendPath(svg, "M7 8h4v4H7zM13 8h4v4h-4zM7 14h4v2H7zM13 14h4v2h-4z", true);
    return svg;
  }

  function createPinIcon() {
    const svg = createSvg("0 0 24 24");
    svg.classList.add("pin-mark");
    appendPath(svg, "M12 17v5M8 3h8l-1 6 3 4v2H6v-2l3-4-1-6Z");
    return svg;
  }

  function createSvg(viewBox) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return svg;
  }

  function appendPath(svg, d, fill = false) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    if (fill) {
      path.setAttribute("fill", "currentColor");
    } else {
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    }
    svg.appendChild(path);
  }

  function getMockData() {
    const now = Date.now();
    const mockTabCount = clampNumber(
      new URLSearchParams(location.search).get("mockTabs"),
      10,
      80,
      10
    );
    const openTabs = [
      mockOpen(1, "Chrome Tab Search popup.js", "https://github.com/zihaod/chrome-tab-search/blob/main/popup.js", {
        colorName: "blue",
        groupName: "Work",
        lastTime: now - 15 * 1000,
        active: true
      }),
      mockOpen(2, "Design Critique - Live Stream", "https://www.youtube.com/watch?v=tab-search", {
        colorName: "orange",
        groupName: "Media",
        lastTime: now - 30 * 1000,
        audible: true
      }),
      mockOpen(3, "Chrome search.ts - Chromium Code Search", "https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resources/tab_search/search.ts", {
        lastTime: now - 45 * 1000
      }),
      mockOpen(4, "Focus playlist - muted", "https://music.example.com/focus/playlist", {
        colorName: "green",
        groupName: "Audio",
        lastTime: now - 2 * 60 * 1000,
        muted: true
      }),
      mockOpen(5, "Chrome Tab Search parity plan", "https://github.com/zihaod/chrome-tab-search/pull/12", {
        colorName: "purple",
        groupName: "Work",
        lastTime: now - 4 * 60 * 1000
      }),
      mockOpen(6, "MDN tabs.query() - WebExtensions", "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query", {
        colorName: "cyan",
        groupName: "Docs",
        lastTime: now - 7 * 60 * 1000
      }),
      mockOpen(7, "Smart quotes ‘ranking’ “highlight” demo", "https://quotes.example.com/smart-ranking", {
        lastTime: now - 9 * 60 * 1000
      }),
      mockOpen(8, "Prefix match report", "https://docs.example.com/prefix-match", {
        lastTime: now - 12 * 60 * 1000
      }),
      mockOpen(9, "Word boundary report", "https://docs.example.com/report-word", {
        lastTime: now - 13 * 60 * 1000
      }),
      mockOpen(10, "New Tab", "about:newtab", {
        lastTime: now - 20 * 60 * 1000
      })
    ];

    for (let id = 11; id <= mockTabCount; id += 1) {
      const minutesAgo = id < 18 ? 1 : 8;
      openTabs.push(mockOpen(id, `Background research ${id}`, `https://example.com/background/${id}`, {
        lastTime: now - minutesAgo * 60 * 1000
      }));
    }

    const sortedOpenTabs = openTabs.sort(sortOpenTabs);
    const closedSessions = [
      mockClosedTab(20, "Duplicate open Chromium search.ts", "https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resources/tab_search/search.ts", now - 5 * 60 * 1000),
      mockClosedTab(21, "Chrome Tab Search review notes", "https://github.com/zihaod/chrome-tab-search/pull/12/files", now - 6 * 60 * 1000),
      mockClosedWindow(22, [
        mockSessionTab(221, "Prefix ranking from closed window", "https://example.com/prefix-ranking"),
        mockSessionTab(222, "Word boundary ranking", "https://example.com/docs/boundary-ranking"),
        mockSessionTab(223, "Duplicate open parity plan", "https://github.com/zihaod/chrome-tab-search/pull/12"),
        mockSessionTab(224, "Closed New Tab", "about:newtab")
      ], now - 8 * 60 * 1000),
      mockClosedTab(23, "Smart quote “closed” result", "https://quotes.example.com/closed", now - 11 * 60 * 1000),
      mockClosedTab(24, "Audio recording notes", "https://media.example.com/recording", now - 16 * 60 * 1000),
      mockClosedTab(25, "Release checklist", "https://example.com/release-checklist", now - 21 * 60 * 1000),
      mockClosedTab(26, "Firefox sessions API", "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sessions", now - 26 * 60 * 1000),
      mockClosedTab(27, "Chrome Web Store dashboard", "https://chrome.google.com/webstore/devconsole", now - 31 * 60 * 1000),
      mockClosedTab(28, "Duplicate closed dashboard", "https://chrome.google.com/webstore/devconsole", now - 36 * 60 * 1000),
      mockClosedTab(29, "Options page QA", "moz-extension://example/options.html", now - 41 * 60 * 1000),
      mockClosedTab(30, "Invalid closed URL", "not a url", now - 46 * 60 * 1000),
      mockClosedTab(31, "Search ranking design", "https://example.com/search-ranking-design", now - 51 * 60 * 1000),
      mockClosedTab(32, "Window restore details", "https://example.com/window-restore-details", now - 56 * 60 * 1000)
    ];

    return {
      openTabs: sortedOpenTabs,
      closedItems: normalizeClosedSessions(closedSessions, sortedOpenTabs)
    };
  }

  function mockOpen(id, title, url, options = {}) {
    const hostname = displayUrl(url);
    const groupColor = options.colorName ? groupColorMap[options.colorName] : groupColorMap.grey;

    return {
      id: `open-${id}`,
      type: "open",
      tabId: id,
      windowId: 1,
      active: Boolean(options.active),
      pinned: Boolean(options.pinned),
      audible: Boolean(options.audible),
      muted: Boolean(options.muted),
      title,
      url,
      hostname,
      displayUrl: hostname,
      favIconUrl: mockFavicon(url),
      lastTime: options.lastTime || Date.now(),
      hasGroup: Boolean(options.colorName || options.groupName),
      groupName: options.groupName || "",
      groupColor,
      groupId: options.colorName || options.groupName ? id : NO_GROUP,
      windowFocused: options.windowFocused !== false
    };
  }

  function mockClosedTab(id, title, url, lastTime) {
    return {
      tab: mockSessionTab(id, title, url),
      lastModified: lastTime
    };
  }

  function mockClosedWindow(id, tabs, lastTime) {
    return {
      window: {
        sessionId: `window-${id}`,
        tabs
      },
      lastModified: lastTime
    };
  }

  function mockSessionTab(id, title, url) {
    return {
      sessionId: String(id),
      title,
      url,
      favIconUrl: mockFavicon(url)
    };
  }

  function mockFavicon(url) {
    if (url.includes("github.com")) return "https://github.githubassets.com/favicons/favicon.svg";
    if (url.includes("developer.mozilla.org")) return "https://developer.mozilla.org/favicon-48x48.cbbd161b.png";
    if (url.includes("youtube.com")) return "https://www.youtube.com/s/desktop/12d6b690/img/favicon_32x32.png";
    return "";
  }
})();

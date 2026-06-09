(function () {
  const OPEN_COMMAND = "_execute_browser_action";
  const RECENTLY_CLOSED_LIMIT = 25;
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

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
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

    if (event.key.length === 1 && !hasCommandModifier(event)) {
      if (!isInteractiveTarget(event.target)) focusSearchInput();
      return;
    }

    if (hasCommandModifier(event)) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      focusSearchInput();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      focusSearchInput();
    } else if (event.key === "Enter" && !isInteractiveTarget(event.target)) {
      event.preventDefault();
      await activateSelected();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePopup();
    }
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

      state.openTabs = openTabs
        .map((tab) => normalizeOpenTab(tab, groups.get(tab.groupId)))
        .sort(sortOpenTabs);
      state.closedItems = normalizeClosedSessions(recentlyClosed);

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
      displayUrl: displayUrl(url),
      favIconUrl: tab.favIconUrl || "",
      lastTime: tab.lastAccessed || Date.now(),
      hasGroup: tab.groupId !== undefined && tab.groupId !== NO_GROUP,
      groupName,
      groupColor,
      groupId: tab.groupId,
      windowFocused: Boolean(tab.windowFocused),
      searchText: normalizeSearchText([title, url, groupName])
    };
  }

  function normalizeClosedSessions(sessions) {
    const items = [];

    sessions.forEach((session, index) => {
      if (session.tab) {
        const tab = session.tab;
        items.push(normalizeClosedTab(tab, session.lastModified, tab.sessionId, index));
      } else if (session.window) {
        const sessionWindow = session.window;
        const tabs = sessionWindow.tabs || [];
        const sessionId = sessionWindow.sessionId;
        const representative = tabs.find((tab) => tab.title || tab.url) || tabs[0];

        if (tabs.length <= 1 && representative) {
          items.push(normalizeClosedTab(representative, session.lastModified, sessionId || representative.sessionId, index, "window"));
        } else if (tabs.length > 1) {
          const allText = tabs.flatMap((tab) => [tab.title || "", tab.url || ""]);
          const hostSummary = representative ? displayUrl(representative.url) : "";
          items.push({
            id: `closed-window-${sessionId || index}`,
            type: "closed",
            restoreType: "window",
            sessionId,
            title: `Window with ${tabs.length} tabs`,
            url: representative?.url || "",
            displayUrl: hostSummary ? `${hostSummary} and ${Math.max(tabs.length - 1, 0)} more` : `${tabs.length} tabs`,
            favIconUrl: representative?.favIconUrl || "",
            lastTime: session.lastModified || Date.now(),
            searchText: normalizeSearchText([`window with ${tabs.length} tabs`, ...allText])
          });
        }
      }
    });

    return items;
  }

  function normalizeClosedTab(tab, lastModified, sessionId, index, restoreType = "tab") {
    const title = tab.title || displayUrl(tab.url) || "Untitled";
    const url = tab.url || "";

    return {
      id: `closed-${sessionId || index}`,
      type: "closed",
      restoreType,
      sessionId,
      title,
      url,
      displayUrl: displayUrl(url),
      favIconUrl: tab.favIconUrl || "",
      lastTime: lastModified || Date.now(),
      searchText: normalizeSearchText([title, url])
    };
  }

  function sortOpenTabs(a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.windowFocused !== b.windowFocused) return a.windowFocused ? -1 : 1;
    if (a.lastTime !== b.lastTime) return b.lastTime - a.lastTime;
    return a.title.localeCompare(b.title);
  }

  function render() {
    const query = normalizeQuery(state.query);
    const openItems = state.openTabs.filter((item) => matchesQuery(item, query));
    const closedItems = state.closedItems.filter((item) => matchesQuery(item, query));
    const visible = [...openItems, ...(state.recentlyClosedExpanded ? closedItems : [])];

    if (!visible.some((item) => item.id === state.selectedId)) {
      state.selectedId = visible[0]?.id || "";
    }

    state.visibleItems = visible;
    els.results.textContent = "";

    if (openItems.length > 0 || state.query === "") {
      els.results.appendChild(createSection("Open Tabs", openItems));
    }

    if (closedItems.length > 0 || state.query === "") {
      els.results.appendChild(createClosedSection(closedItems));
    }

    if (openItems.length === 0 && closedItems.length === 0) {
      els.results.appendChild(createEmptyState(state.query ? "No tabs found" : "No tabs to show"));
    }

    renderSelection();
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
    title.textContent = item.title;
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
        name.textContent = item.groupName;
        chip.appendChild(name);
      }

      meta.appendChild(chip);
      meta.appendChild(createSeparator());
    }

    const url = document.createElement("span");
    url.className = "meta-text";
    url.textContent = item.displayUrl || "Unknown";
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

  function matchesQuery(item, query) {
    if (!query) return true;
    return item.searchText.includes(query);
  }

  function normalizeQuery(query) {
    return query.trim().toLocaleLowerCase();
  }

  function normalizeSearchText(parts) {
    return parts.filter(Boolean).join(" ").toLocaleLowerCase();
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
      4,
      80,
      4
    );
    const openTabs = [
      mockOpen(1, "New Tab", "about:newtab", "blue", "asdf...", now - 2 * 60 * 1000, true),
      mockOpen(2, "wilmtang (Zod D)", "https://github.com/wilmtang/zod-discriminated", "", "", now - 2 * 60 * 1000),
      mockOpen(3, "New Tab", "about:newtab", "", "", now - 2 * 60 * 1000),
      mockOpen(4, "New Tab", "about:newtab", "blue", "asdfa...", now - 2 * 60 * 1000)
    ];

    for (let id = 5; id <= mockTabCount; id += 1) {
      const minutesAgo = id < 18 ? 1 : 8;
      openTabs.push(mockOpen(id, "New Tab", "about:newtab", "", "", now - minutesAgo * 60 * 1000));
    }

    return {
      openTabs,
      closedItems: [
        mockClosed(20, "Status", "https://chrome.google.com/webstore/devconsole/status", "pink", now - 11 * 60 * 1000),
        mockClosed(21, "Audience - Google Auth Platform - Chrome Web Store", "https://console.cloud.google.com/apis/credentials", "pink", now - 11 * 60 * 1000),
        mockClosed(22, "Store Listing", "https://chrome.google.com/webstore/devconsole/store-listing", "", now - 11 * 60 * 1000),
        mockClosed(23, "Chrome Extension - Workflow runs", "https://github.com/zihaod/chrome-extension/actions", "", now - 38 * 60 * 1000),
        mockClosed(24, "LeetCode VS Code Auth Sync - Chrome Web Store", "https://chromewebstore.google.com/detail/leetcode-vs-code-auth-sync", "pink", now - 39 * 60 * 1000),
        mockClosed(25, "vscode-leetcode/PRIVACY.md at main", "https://github.com/zihaod/vscode-leetcode/blob/main/PRIVACY.md", "", now - 50 * 60 * 1000)
      ]
    };
  }

  function mockOpen(id, title, url, colorName, groupName, lastTime, active = false) {
    return {
      id: `open-${id}`,
      type: "open",
      tabId: id,
      windowId: 1,
      active,
      pinned: false,
      title,
      url,
      displayUrl: displayUrl(url),
      favIconUrl: url.includes("github") ? "https://github.githubassets.com/favicons/favicon.svg" : "",
      lastTime,
      groupName,
      groupColor: colorName ? groupColorMap[colorName] : "",
      searchText: normalizeSearchText([title, url, groupName])
    };
  }

  function mockClosed(id, title, url, colorName, lastTime) {
    return {
      id: `closed-${id}`,
      type: "closed",
      restoreType: "tab",
      sessionId: String(id),
      title,
      url,
      displayUrl: displayUrl(url),
      favIconUrl: url.includes("github") ? "https://github.githubassets.com/favicons/favicon.svg" : "",
      lastTime,
      groupName: colorName ? "Co..." : "",
      groupColor: colorName ? groupColorMap[colorName] : "",
      searchText: normalizeSearchText([title, url])
    };
  }
})();

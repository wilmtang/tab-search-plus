if (typeof browser === "undefined") {
  var browser = {
    commands: {
      async getAll() {
        return [{ name: "_execute_browser_action", shortcut: "Command+MacCtrl+A" }];
      },
      async update() {},
      async reset() {},
      async openShortcutSettings() {}
    }
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  const statusDiv = document.getElementById("status");

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    if (type) {
      setTimeout(() => {
        statusDiv.textContent = "";
        statusDiv.className = "";
      }, 4000);
    }
  }

  function isMac() {
    return navigator.platform?.toLowerCase().includes("mac") ||
      navigator.userAgent?.toLowerCase().includes("mac");
  }

  const validModifiers = new Set(["Ctrl", "Alt", "Command", "MacCtrl", "Shift"]);
  const primaryModifiers = new Set(["Ctrl", "Alt", "Command", "MacCtrl"]);
  const validKeys = new Set([
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    "F13", "F14", "F15", "F16", "F17", "F18", "F19",
    "Comma", "Period", "Home", "End", "PageUp", "PageDown",
    "Space", "Insert", "Delete", "Up", "Down", "Left", "Right"
  ]);

  const keyMap = {
    Control: null,
    Alt: null,
    Meta: null,
    Shift: null,
    Tab: null,
    CapsLock: null,
    ",": "Comma",
    ".": "Period",
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Home: "Home",
    End: "End",
    Insert: "Insert",
    Delete: "Delete"
  };

  function validateShortcut(shortcutString) {
    if (!shortcutString) return { valid: true };
    const parts = shortcutString.split("+");
    if (parts.length < 2 || parts.length > 3) {
      return { valid: false, reason: "Must have 2 or 3 keys." };
    }

    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);
    if (!validKeys.has(key)) return { valid: false, reason: `"${key}" is not a valid shortcut key.` };
    if (!modifiers.some((modifier) => primaryModifiers.has(modifier))) {
      return { valid: false, reason: "Must include Ctrl, Alt, Command, or MacCtrl." };
    }

    const seen = new Set();
    for (const modifier of modifiers) {
      if (!validModifiers.has(modifier)) return { valid: false, reason: `"${modifier}" is not a valid modifier.` };
      if (seen.has(modifier)) return { valid: false, reason: "Cannot use the same modifier twice." };
      seen.add(modifier);
    }

    return { valid: true };
  }

  function eventToShortcutParts(event) {
    const modifiers = [];
    if (event.metaKey) modifiers.push("Command");
    if (event.ctrlKey) modifiers.push(isMac() ? "MacCtrl" : "Ctrl");
    if (event.altKey) modifiers.push("Alt");
    if (event.shiftKey) modifiers.push("Shift");

    let key = event.key;
    if (["Control", "Alt", "Meta", "Shift", "CapsLock", "Tab"].includes(key)) {
      return { modifiers, key: null };
    }

    if (keyMap[key] !== undefined) {
      key = keyMap[key];
    } else if (key.length === 1) {
      key = key.toUpperCase();
    } else if (key.startsWith("F") && !Number.isNaN(Number(key.slice(1))) && key.length <= 3) {
      key = key.toUpperCase();
    } else {
      key = null;
    }

    return { modifiers, key };
  }

  function normalizeTypedString(typed) {
    if (!typed) return "";
    const parts = typed.toLowerCase().split(/[\s+\-]+/).filter(Boolean);
    const modifiers = [];
    let key = null;

    for (const part of parts) {
      if (["ctrl", "control", "macctrl"].includes(part)) modifiers.push(isMac() ? "MacCtrl" : "Ctrl");
      else if (["cmd", "command", "meta", "win", "windows"].includes(part)) modifiers.push("Command");
      else if (["alt", "opt", "option"].includes(part)) modifiers.push("Alt");
      else if (part === "shift") modifiers.push("Shift");
      else if (part.length === 1) key = part.toUpperCase();
      else if (/^f\d{1,2}$/.test(part)) key = part.toUpperCase();
      else {
        const candidate = part.charAt(0).toUpperCase() + part.slice(1);
        if (validKeys.has(candidate)) key = candidate;
        else if (part === "space") key = "Space";
        else if (part === "up") key = "Up";
        else if (part === "down") key = "Down";
        else if (part === "left") key = "Left";
        else if (part === "right") key = "Right";
      }
    }

    const dedupedModifiers = [...new Set(modifiers)];
    return key ? [...dedupedModifiers, key].join("+") : dedupedModifiers.join("+");
  }

  class ShortcutItem {
    constructor(element, commandData) {
      this.element = element;
      this.commandName = element.dataset.command;
      this.defaultShortcut = commandData?.shortcut || "";
      this.currentShortcut = "";
      this.isRecording = false;
      this.pendingShortcut = "";

      this.container = element.querySelector(".shortcut-input-container");
      this.input = element.querySelector(".shortcut-text-input");
      this.displayLayer = element.querySelector(".shortcut-display-layer");
      this.recordButton = element.querySelector(".btn-record");
      this.resetButton = element.querySelector(".btn-reset");
      this.clearButton = element.querySelector(".btn-clear");
      this.validationMessage = element.querySelector(".validation-msg");

      this.initEvents();
      this.load();
    }

    async load() {
      const commands = await browser.commands.getAll();
      const command = commands.find((entry) => entry.name === this.commandName);
      this.currentShortcut = command?.shortcut || "";
      this.updateUI(this.currentShortcut);
    }

    updateUI(shortcutString, isRecordingLive = false) {
      this.input.value = shortcutString ? shortcutString.replace(/MacCtrl/g, "Ctrl") : "";
      this.input.classList.toggle("has-badges", Boolean(shortcutString) && !isRecordingLive);
      this.displayLayer.textContent = "";

      if (!shortcutString && !isRecordingLive) return;

      if (isRecordingLive && !shortcutString) {
        const label = document.createElement("span");
        label.className = "recording-label";
        label.textContent = "Press keys...";
        this.displayLayer.appendChild(label);
        return;
      }

      const parts = shortcutString.split("+");
      parts.forEach((part, index) => {
        if (!part) return;
        const badge = document.createElement("span");
        badge.className = "key-badge";
        badge.textContent = this.displayPart(part);
        this.displayLayer.appendChild(badge);

        if (index < parts.length - 1 && parts[index + 1]) {
          const separator = document.createElement("span");
          separator.className = "key-separator";
          separator.textContent = "+";
          this.displayLayer.appendChild(separator);
        }
      });
    }

    displayPart(part) {
      if (!isMac()) return part;
      if (part === "Command") return "⌘ Cmd";
      if (part === "Alt") return "⌥ Option";
      if (part === "MacCtrl") return "⌃ Ctrl";
      if (part === "Shift") return "⇧ Shift";
      return part;
    }

    showError(message) {
      this.validationMessage.textContent = message;
      this.validationMessage.className = "validation-msg show error";
    }

    hideError() {
      this.validationMessage.className = "validation-msg";
      this.validationMessage.textContent = "";
    }

    async saveShortcut(newShortcut) {
      try {
        await browser.commands.update({
          name: this.commandName,
          shortcut: newShortcut
        });
        this.currentShortcut = newShortcut;
        this.updateUI(newShortcut);
        showStatus(newShortcut ? "Shortcut saved successfully." : "Shortcut cleared.", "success");
      } catch (error) {
        this.showError(`Firefox rejected this shortcut: ${error.message}`);
        this.updateUI(this.currentShortcut);
      }
    }

    handleBlur = () => {
      if (this.isRecording) return;
      const normalized = normalizeTypedString(this.input.value);

      if (normalized === this.currentShortcut) {
        this.updateUI(this.currentShortcut);
        this.hideError();
        return;
      }

      const validation = validateShortcut(normalized);
      if (!validation.valid) {
        this.showError(validation.reason);
        this.updateUI(this.currentShortcut);
      } else {
        this.hideError();
        this.saveShortcut(normalized);
      }
    };

    startRecording() {
      this.isRecording = true;
      this.recordButton.textContent = "Stop";
      this.recordButton.classList.add("is-recording");
      this.container.classList.add("recording");
      this.hideError();
      this.input.focus();
      this.input.value = "";
      this.input.classList.add("has-badges");
      this.updateUI("", true);
    }

    stopRecording(save = false) {
      this.isRecording = false;
      this.recordButton.textContent = "Record";
      this.recordButton.classList.remove("is-recording");
      this.container.classList.remove("recording");

      if (save) {
        this.saveShortcut(this.pendingShortcut);
      } else {
        this.updateUI(this.currentShortcut);
      }
    }

    handleKeyDown = (event) => {
      if (!this.isRecording) {
        if (event.key === "Enter") {
          event.preventDefault();
          this.input.blur();
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        this.stopRecording(false);
        return;
      }

      if (event.key === "Backspace" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        this.pendingShortcut = "";
        this.stopRecording(true);
        return;
      }

      const result = eventToShortcutParts(event);
      if (!result.key) {
        this.updateUI(result.modifiers.join("+"), true);
        return;
      }

      const shortcutString = [...result.modifiers, result.key].join("+");
      const validation = validateShortcut(shortcutString);
      if (!validation.valid) {
        this.showError(validation.reason);
        this.stopRecording(false);
        return;
      }

      this.pendingShortcut = shortcutString;
      this.hideError();
      this.stopRecording(true);
    };

    initEvents() {
      this.input.addEventListener("blur", this.handleBlur);
      this.input.addEventListener("keydown", this.handleKeyDown);

      this.recordButton.addEventListener("click", () => {
        if (this.isRecording) this.stopRecording(false);
        else this.startRecording();
      });

      this.clearButton.addEventListener("click", (event) => {
        event.preventDefault();
        if (this.isRecording) this.stopRecording(false);
        this.hideError();
        this.saveShortcut("");
      });

      this.resetButton.addEventListener("click", async (event) => {
        event.preventDefault();
        if (this.isRecording) this.stopRecording(false);
        this.hideError();

        try {
          await browser.commands.reset(this.commandName);
          const commands = await browser.commands.getAll();
          const command = commands.find((entry) => entry.name === this.commandName);
          this.currentShortcut = command?.shortcut || "";
          this.updateUI(this.currentShortcut);
          showStatus("Shortcut reset to default.", "success");
        } catch (error) {
          this.showError(`Could not reset shortcut: ${error.message}`);
        }
      });
    }
  }

  const commands = await browser.commands.getAll();
  document.querySelectorAll(".shortcut-item").forEach((element) => {
    const commandName = element.dataset.command;
    new ShortcutItem(element, commands.find((command) => command.name === commandName));
  });

  const shortcutManagerButton = document.getElementById("open-shortcut-settings");
  shortcutManagerButton.addEventListener("click", async () => {
    if (browser.commands.openShortcutSettings) {
      await browser.commands.openShortcutSettings();
      return;
    }

    showStatus("Open about:addons and choose Manage Extension Shortcuts.", "success");
  });
});

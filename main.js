"use strict";

const {
  Plugin,
  Modal,
  SuggestModal,
  Notice,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  prepareFuzzySearch,
  moment,
} = require("obsidian");

const DEFAULT_SETTINGS = {
  contactsFolder: "Contacts",
  meetingsFolder: "Meetings",
  formalTemplate: "",
  informalTemplate: "",
  openInNewTab: true,
};

// Built-in note bodies. Frontmatter is added by the plugin, so templates only need the body.
// Placeholders: {{title}} {{type}} {{people}} {{date}} {{date:FORMAT}} {{time}} {{time:FORMAT}}
const DEFAULT_BODIES = {
  formal: [
    "## Agenda",
    "- ",
    "## Minutes",
    "- ",
    "## Decisions",
    "- ",
    "## Action items",
    "- [ ] ",
    "",
  ].join("\n"),
  informal: ["## Discussed", "- ", "## Follow-ups", "- [ ] ", ""].join("\n"),
};

// ---------- helpers ----------

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// "[[Contacts/Jane Doe|Jane]]" -> "Contacts/Jane Doe"
const stripLink = (s) =>
  String(s).trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();

// "Contacts/Jane Doe" -> "Jane Doe"
const displayName = (link) => link.split("/").pop();

const sanitizeName = (s) =>
  s.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();

const formatList = (names) =>
  names.length <= 1
    ? names.join("")
    : names.slice(0, -1).join(", ") + " & " + names[names.length - 1];

// ---------- plugin ----------

module.exports = class PersonalMeetingNotes extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "create-formal-meeting",
      name: "Create formal meeting note",
      callback: () => this.createMeeting("formal"),
    });

    this.addCommand({
      id: "create-informal-meeting",
      name: "Create informal meeting note",
      callback: () => this.createMeeting("informal"),
    });

    this.addCommand({
      id: "add-person-to-meeting",
      name: "Add person to current meeting",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = file && this.isMeeting(file);
        if (checking) return !!ok;
        if (ok) this.addPeopleTo(file);
        return true;
      },
    });

    this.addCommand({
      id: "show-missing-people",
      name: "Show people not yet in contacts",
      callback: () => this.showMissing(),
    });

    this.addSettingTab(new MeetingSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Contact notes = Markdown files directly inside the contacts folder.
  // iCloud Contacts only manages files at that level, so Deleted/ and other subfolders are skipped.
  getContacts() {
    const folder = normalizePath(this.settings.contactsFolder);
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.parent && f.parent.path === folder && f.basename !== "Errors")
      .map((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {};
        const aliases = [...toArray(fm.aliases), ...toArray(fm.name)].filter(
          (a) => typeof a === "string" && a !== f.basename
        );
        return {
          file: f,
          name: f.basename,
          link: this.app.metadataCache.fileToLinktext(f, ""),
          aliases,
        };
      });
  }

  isMeeting(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return toArray(fm?.tags).some((t) => String(t).replace(/^#/, "") === "meeting");
  }

  // Resolves to an array of link texts, or null if cancelled.
  pickPeople(initial = []) {
    return new Promise((resolve) => {
      const selected = [...initial];
      const open = () =>
        new PersonSuggestModal(this.app, this, selected, (result) => {
          if (result.kind === "cancel") return resolve(null);
          if (result.kind === "done") return resolve(selected);
          const link = sanitizeName(result.link);
          if (link && !selected.includes(link)) selected.push(link);
          open();
        }).open();
      open();
    });
  }

  prompt(opts) {
    return new Promise((resolve) => new TextPromptModal(this.app, opts, resolve).open());
  }

  async createMeeting(type) {
    const people = await this.pickPeople();
    if (people === null) return;

    const names = people.map(displayName);
    const chatTitle = names.length ? `Chat with ${formatList(names)}` : "Chat";
    const title = await this.prompt({
      heading: type === "formal" ? "Formal meeting: title" : "Informal meeting: topic",
      placeholder: type === "formal" ? "Meeting title" : "Topic (optional)",
      value: type === "informal" ? chatTitle : "",
    });
    if (title === null) return;

    const now = moment();
    const finalTitle = sanitizeName(title) || (type === "formal" ? "Meeting" : chatTitle);

    const folder = normalizePath(this.settings.meetingsFolder);
    await this.ensureFolder(folder);
    const path = this.uniquePath(folder, sanitizeName(`${now.format("YYYY-MM-DD")} ${finalTitle}`));

    const body = await this.renderBody(type, { title: finalTitle, date: now, people });
    const file = await this.app.vault.create(path, body);

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const stamp = now.format("YYYY-MM-DDTHH:mm:ssZ");
      if (fm.created == null) fm.created = stamp;
      fm.modified = stamp;
      const tags = toArray(fm.tags).map(String);
      if (!tags.includes("meeting")) tags.push("meeting");
      fm.tags = tags;
      fm.type = type;
      fm.date = now.format("YYYY-MM-DD");
      fm.people = people.map((p) => `[[${p}]]`);
    });

    const leaf = this.app.workspace.getLeaf(this.settings.openInNewTab ? "tab" : false);
    await leaf.openFile(file);
    this.placeCursor(leaf);
  }

  async addPeopleTo(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const existing = toArray(fm?.people).filter((p) => typeof p === "string").map(stripLink);
    const result = await this.pickPeople(existing);
    if (result === null) return;
    const added = result.slice(existing.length);
    if (!added.length) return;
    await this.app.fileManager.processFrontMatter(file, (f) => {
      f.people = [...toArray(f.people), ...added.map((p) => `[[${p}]]`)];
      f.modified = moment().format("YYYY-MM-DDTHH:mm:ssZ");
    });
    new Notice(`Added ${formatList(added.map(displayName))}`);
  }

  async showMissing() {
    const missing = new Map();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!this.isMeeting(f)) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      for (const raw of toArray(fm?.people)) {
        if (typeof raw !== "string") continue;
        const link = stripLink(raw);
        if (!link || this.app.metadataCache.getFirstLinkpathDest(link, f.path)) continue;
        const entry = missing.get(link) || { name: link, files: [] };
        entry.files.push(f);
        missing.set(link, entry);
      }
    }
    if (!missing.size) {
      new Notice("Everyone in your meeting notes has a contact note.");
      return;
    }
    new MissingPeopleModal(this.app, [...missing.values()]).open();
  }

  async renderBody(type, ctx) {
    let tpl = DEFAULT_BODIES[type];
    const tplPath = (type === "formal" ? this.settings.formalTemplate : this.settings.informalTemplate).trim();
    if (tplPath) {
      const p = normalizePath(tplPath.endsWith(".md") ? tplPath : `${tplPath}.md`);
      const f = this.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) tpl = await this.app.vault.read(f);
      else new Notice(`Meeting template not found: ${p}. Using the built-in one.`);
    }
    const peopleList = ctx.people.length ? ctx.people.map((p) => `- [[${p}]]`).join("\n") : "- ";
    return tpl
      .replace(/{{title}}/g, () => ctx.title)
      .replace(/{{type}}/g, () => type)
      .replace(/{{people}}/g, () => peopleList)
      .replace(/{{date(?::([^}]+))?}}/g, (_, fmt) => ctx.date.format(fmt || "YYYY-MM-DD"))
      .replace(/{{time(?::([^}]+))?}}/g, (_, fmt) => ctx.date.format(fmt || "HH:mm"));
  }

  async ensureFolder(folder) {
    if (folder === "/" || this.app.vault.getAbstractFileByPath(folder)) return;
    try {
      await this.app.vault.createFolder(folder);
    } catch (e) {
      // Folder may have been created in the meantime.
    }
  }

  uniquePath(folder, base) {
    const prefix = folder === "/" ? "" : `${folder}/`;
    let path = normalizePath(`${prefix}${base}.md`);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) {
      path = normalizePath(`${prefix}${base} ${i}.md`);
    }
    return path;
  }

  // Put the cursor on the first empty bullet so you can start typing straight away.
  placeCursor(leaf) {
    const editor = leaf.view?.editor;
    if (!editor) return;
    for (let i = 0; i < editor.lineCount(); i++) {
      const line = editor.getLine(i);
      if (/^- (\[ \] )?$/.test(line)) {
        editor.setCursor({ line: i, ch: line.length });
        editor.focus();
        return;
      }
    }
  }
};

// ---------- modals ----------

class PersonSuggestModal extends SuggestModal {
  constructor(app, plugin, selected, onResult) {
    super(app);
    this.selected = selected;
    this.onResult = onResult;
    this.chosen = false;
    this.contacts = plugin.getContacts();
    this.limit = 50;
    this.emptyStateText = "No matches";
    this.setPlaceholder(
      selected.length
        ? `Added: ${formatList(selected.map(displayName))}. Add another…`
        : "Who was part? Type a name…"
    );
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "add" },
      { command: "esc", purpose: selected.length ? "done" : "cancel" },
    ]);
  }

  getSuggestions(query) {
    const q = query.trim();
    const available = this.contacts.filter((c) => !this.selected.includes(c.link));

    if (!q) {
      return [
        { kind: "done" },
        ...available
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ kind: "contact", contact: c })),
      ];
    }

    const fuzzy = prepareFuzzySearch(q);
    const matches = [];
    for (const c of available) {
      let best = null;
      for (const text of [c.name, ...c.aliases]) {
        const m = fuzzy(text);
        if (m && (!best || m.score > best.score)) best = m;
      }
      if (best) matches.push({ kind: "contact", contact: c, score: best.score });
    }
    matches.sort((a, b) => b.score - a.score);

    const lower = q.toLowerCase();
    const exact = this.contacts.some((c) =>
      [c.name, ...c.aliases].some((t) => t.toLowerCase() === lower)
    );
    if (!exact && !this.selected.includes(sanitizeName(q))) {
      matches.push({ kind: "stub", name: q });
    }
    return matches;
  }

  renderSuggestion(item, el) {
    if (item.kind === "done") {
      el.addClass("pmn-done");
      el.setText(
        this.selected.length
          ? `✓ Done (${this.selected.length} ${this.selected.length === 1 ? "person" : "people"})`
          : "Continue without people"
      );
    } else if (item.kind === "contact") {
      el.createDiv({ text: item.contact.name });
      if (item.contact.aliases.length) {
        el.createEl("small", { text: item.contact.aliases.join(", "), cls: "pmn-muted" });
      }
    } else {
      el.addClass("pmn-stub");
      el.createDiv({ text: `+ Add “${sanitizeName(item.name)}” as stub` });
      el.createEl("small", { text: "Not in contacts yet. Links up once the contact syncs.", cls: "pmn-muted" });
    }
  }

  selectSuggestion(value, evt) {
    this.chosen = true;
    super.selectSuggestion(value, evt);
  }

  onChooseSuggestion(item) {
    if (item.kind === "done") this.onResult({ kind: "done" });
    else if (item.kind === "contact") this.onResult({ kind: "add", link: item.contact.link });
    else this.onResult({ kind: "add", link: item.name });
  }

  onClose() {
    if (!this.chosen) this.onResult({ kind: this.selected.length ? "done" : "cancel" });
  }
}

class TextPromptModal extends Modal {
  constructor(app, { heading, placeholder = "", value = "" }, onResult) {
    super(app);
    this.heading = heading;
    this.placeholder = placeholder;
    this.value = value;
    this.onResult = onResult;
    this.submitted = false;
  }

  onOpen() {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl("input", {
      type: "text",
      cls: "pmn-input",
      attr: { placeholder: this.placeholder },
    });
    input.value = this.value;
    this.contentEl.createEl("small", { text: "↵ create · esc cancel", cls: "pmn-muted" });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        this.submitted = true;
        const v = input.value.trim();
        this.close();
        this.onResult(v);
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose() {
    this.contentEl.empty();
    if (!this.submitted) this.onResult(null);
  }
}

class MissingPeopleModal extends SuggestModal {
  constructor(app, entries) {
    super(app);
    this.entries = entries.sort((a, b) => a.name.localeCompare(b.name));
    this.setPlaceholder("People in meeting notes without a contact note");
    this.setInstructions([{ command: "↵", purpose: "open latest meeting with them" }]);
  }

  getSuggestions(query) {
    const q = query.toLowerCase();
    return this.entries.filter((e) => e.name.toLowerCase().includes(q));
  }

  renderSuggestion(entry, el) {
    el.createDiv({ text: entry.name });
    const n = entry.files.length;
    el.createEl("small", { text: `${n} meeting${n === 1 ? "" : "s"}`, cls: "pmn-muted" });
  }

  onChooseSuggestion(entry) {
    const latest = [...entry.files].sort((a, b) => b.stat.ctime - a.stat.ctime)[0];
    this.app.workspace.getLeaf(false).openFile(latest);
  }
}

// ---------- settings ----------

class MeetingSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    const text = (name, desc, key, placeholder) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t
            .setPlaceholder(placeholder)
            .setValue(this.plugin.settings[key])
            .onChange(async (v) => {
              this.plugin.settings[key] = v.trim();
              await this.plugin.saveSettings();
            })
        );

    text("Contacts folder", "Folder your iCloud Contacts notes sync into. Only notes directly inside it are offered.", "contactsFolder", "Contacts");
    text("Meetings folder", "Where new meeting notes are created.", "meetingsFolder", "Meetings");
    text("Formal template", "Optional note to use as the body. Leave empty for the built-in one.", "formalTemplate", "Templates/Formal meeting");
    text("Informal template", "Optional note to use as the body. Leave empty for the built-in one.", "informalTemplate", "Templates/Informal meeting");

    new Setting(containerEl)
      .setName("Open in new tab")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.openInNewTab).onChange(async (v) => {
          this.plugin.settings.openInNewTab = v;
          await this.plugin.saveSettings();
        })
      );
  }
}

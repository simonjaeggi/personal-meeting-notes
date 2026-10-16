# Meetings (Obsidian plugin)

Create formal and informal meeting notes from the command palette, and pick the participants from your [iCloud Contacts](https://github.com/trulsaa/obsidian-icloud-contacts) notes.

## Features

- **Create formal meeting note** / **Create informal meeting note**: fuzzy-search your contacts folder to add participants, then set a title. The note gets `created`, `modified`, `tags: meeting`, `type`, `date` and `people` properties.
- **Stub links** for people who aren't in your contacts yet. They're written as plain `[[Name]]` links without creating a file, so they resolve once the contact syncs from iCloud.
- **Add person to current meeting**: add participants to an existing meeting note.
- **Show people not yet in contacts**: list every stub that hasn't resolved yet.
- Optional custom templates with `{{title}}`, `{{type}}`, `{{people}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}` placeholders.

## Install

Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/personal-meeting-notes/`, then enable **Meetings** under Settings → Community plugins. Set the contacts and meetings folders in the plugin settings.

---

Created with [Claude](https://claude.ai).

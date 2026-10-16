# Meetings (Obsidian plugin)

Create formal and informal meeting notes from the command palette, and pick the participants from your [iCloud Contacts](https://github.com/trulsaa/obsidian-icloud-contacts) notes.

## Features

- **Create formal meeting note** / **Create informal meeting note**: fuzzy-search your contacts folder to add participants, then set a title. The note gets `created`, `modified`, `tags: meeting`, `type`, `date` and `people` properties.
- **Stub links** for people who aren't in your contacts yet. They're written as plain `[[Name]]` links without creating a file, so they resolve once the contact syncs from iCloud.
- **Add person to current meeting**: add participants to an existing meeting note.
- **Show people not yet in contacts**: list every stub that hasn't resolved yet.
- **Contacts scope** in the settings: contacts folder (with autocomplete), an *Include subfolders* toggle, and excluded folders such as `Archive` or iCloud Contacts' `Deleted`. The settings show how many contacts were found.
- Optional custom templates with `{{title}}`, `{{type}}`, `{{people}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}` placeholders.

## What counts as a contact

A note is offered in the participant search when:

- it's a Markdown (`.md`) note in the contacts folder set in the plugin settings (directly inside it, or in a subfolder if *Include subfolders* is on),
- it isn't inside an excluded folder (default: `Deleted`, `Archive`), and
- it isn't `Errors.md` at the top of the contacts folder (the iCloud Contacts error log).

No particular properties are required, so notes you write by hand work as well as notes synced by iCloud Contacts. The search matches:

- the **file name**, e.g. `Jane Doe.md`,
- any **`aliases`** in the frontmatter, e.g. `aliases: [Jane, JD]`,
- a **`name`** property, if it's plain text.

Meeting notes link to the file name (`[[Jane Doe]]`), so a stub like `[[Max Muster]]` resolves as soon as a contact note named `Max Muster.md` exists.

## Install

Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/personal-meeting-notes/`, then enable **Meetings** under Settings → Community plugins. Set the contacts and meetings folders in the plugin settings. Requires Obsidian 1.4.10 or later.

---

Created with [Claude](https://claude.ai).

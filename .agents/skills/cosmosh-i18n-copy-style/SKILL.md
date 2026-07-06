---
name: cosmosh-i18n-copy-style
description: Cosmosh locale copy editing and validation workflow for packages/i18n locale JSON files. Use when updating, reviewing, deleting, or syncing supported UI locales, backend/main/renderer locale strings, unused i18n keys, placeholders, feature names, and copy tone in the Cosmosh repository.
---

# Cosmosh I18n Copy Style

Use this skill for Cosmosh localization work in `packages/i18n/locales/**`.
Treat locale copy as product UI: concise, user-facing, and synchronized across supported locales.

## Workflow

1. Establish the copy baseline from existing locale strings, `docs/developer/design/localization-terminology.md`, nearby product surfaces, and any explicit user-provided examples or constraints.
2. Identify the affected namespace and keep every accepted wording change synchronized across all supported locales.
3. Preserve interpolation placeholders, ICU-like tokens, key names, and JSON structure exactly unless the task is explicitly to remove a key.
4. Before deleting any key, search for exact references outside locale files. Also check dynamic namespaces such as Settings registry labels, options, placeholders, and helper text.
5. Keep changes scoped to locale files unless the user explicitly asks for implementation or documentation changes.
6. Read `docs/developer/design/localization-terminology.md` before naming product surfaces, feature modules, settings categories, or major SSH/SFTP concepts.
7. Sort and validate locales before finishing.

## Copy Principles

- Prefer user-facing outcomes over implementation details.
- Keep `zh-CN` concise and natural; avoid literal translations from English.
- Keep `en` plain and product-like; avoid verbose success/failure narration.
- For additional locales, follow the target language's product UI conventions while preserving Cosmosh feature naming and placeholder contracts.
- Prefer state/result phrasing such as `已...` in Chinese and direct result phrasing in English.
- Avoid exposing internal field names unless the UI is explicitly naming a schema or developer field.
- Avoid raw technical terms in user-facing Chinese when a natural phrase exists.
- Remove filler such as "successfully" / "成功" unless it carries real information.
- Preserve product and protocol names when they are the user's mental model, such as SSH, SFTP, API, and URL.

## Glossary

Read `docs/developer/design/localization-terminology.md` for the concept-first feature-name glossary. It is a naming anchor for product surfaces and major concepts, not an exhaustive locale key index. Update the English source page and synchronized Chinese page in the same change whenever a stable feature name is added or changed.

## Deletion Audit

Treat deletion as a separate proof step:

- Search each removed key outside `packages/i18n/locales`.
- Search parent namespaces when components build translation keys dynamically.
- Confirm removed options are not referenced by registries or generated setting metadata.
- Report the evidence in the final response when deletion is part of the task.

## Validation

Run these checks from the repository root when locale files change:

```powershell
node packages\i18n\scripts\check-locales.mjs
node packages\i18n\scripts\sort-locales.mjs --check
git diff --check
```

If sorting fails, run the locale sort command used by the repository, then re-run validation.
When commits are requested, let the pre-commit hook run the same locale checks unless the user explicitly asks otherwise.

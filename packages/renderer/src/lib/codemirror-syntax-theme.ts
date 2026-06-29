import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

const cosmoshCodeMirrorHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--color-syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--color-syntax-keyword)' },
  { tag: [tags.controlKeyword, tags.processingInstruction], color: 'var(--color-syntax-meta)' },
  { tag: [tags.string, tags.special(tags.string), tags.escape, tags.regexp], color: 'var(--color-syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal], color: 'var(--color-syntax-literal)' },
  { tag: [tags.className, tags.typeName], color: 'var(--color-syntax-type)' },
  { tag: [tags.tagName, tags.standard(tags.tagName)], color: 'var(--color-syntax-tag)' },
  { tag: tags.attributeName, color: 'var(--color-syntax-attribute)' },
  { tag: tags.propertyName, color: 'var(--color-syntax-property)' },
  { tag: tags.attributeValue, color: 'var(--color-syntax-string)' },
  {
    tag: [tags.function(tags.variableName), tags.definition(tags.variableName)],
    color: 'var(--color-syntax-definition)',
  },
  { tag: tags.variableName, color: 'var(--color-syntax-text)' },
  {
    tag: [tags.operator, tags.compareOperator, tags.logicOperator, tags.arithmeticOperator],
    color: 'var(--color-syntax-operator)',
  },
  {
    tag: [tags.punctuation, tags.separator, tags.bracket, tags.squareBracket, tags.paren, tags.brace],
    color: 'var(--color-syntax-punctuation)',
  },
  { tag: tags.meta, color: 'var(--color-syntax-meta)' },
  { tag: [tags.heading, tags.strong], color: 'var(--color-syntax-keyword)', fontWeight: '600' },
  { tag: tags.emphasis, color: 'var(--color-syntax-text)', fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--color-syntax-link)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--color-syntax-invalid)' },
]);

/**
 * Shared CodeMirror syntax highlighting extension for renderer editor surfaces.
 *
 * The palette follows the VS Code Dark+ reading rhythm while sourcing every color
 * from Cosmosh semantic tokens so SFTP previews and the Settings JSON editor stay aligned.
 */
export const cosmoshCodeMirrorSyntaxHighlighting: Extension = syntaxHighlighting(cosmoshCodeMirrorHighlightStyle);

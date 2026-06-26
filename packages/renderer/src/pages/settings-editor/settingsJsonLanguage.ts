import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { autocompletion } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import type { Diagnostic } from '@codemirror/lint';
import { linter, lintGutter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView, Tooltip } from '@codemirror/view';
import { hoverTooltip, tooltips } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { tags } from '@lezer/highlight';

import { t } from '../../lib/i18n';
import type { SettingsJsonSchemaNode } from '../settings-registry';

export type JsonSchemaNode = SettingsJsonSchemaNode;

export type JsonSchemaDocument = {
  $schema: string;
  title: string;
  type: 'object';
  additionalProperties: boolean;
  properties: Record<string, JsonSchemaNode>;
  required: string[];
};

type JsonAstNodeKind = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'property' | 'string';

type JsonAstNode = {
  children: JsonAstNode[];
  from: number;
  key?: string;
  keyFrom?: number;
  keyTo?: number;
  kind: JsonAstNodeKind;
  node: SyntaxNode;
  parent?: JsonAstNode;
  to: number;
  value?: unknown;
  valueNode?: JsonAstNode;
};

type SettingsJsonDocumentIndex = {
  root: JsonAstNode | null;
  syntaxErrors: Diagnostic[];
};

type JsonPathSegment = string | number;

type SettingsSchemaContext = {
  path: JsonPathSegment[];
  schema: JsonSchemaNode;
};

const SETTINGS_JSON_LINT_SOURCE = 'Settings schema';

/**
 * Low-saturation syntax colors matched to Cosmosh workbench tokens.
 */
export const settingsJsonHighlightStyle = HighlightStyle.define([
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--color-home-icon-indigo-ink)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-home-icon-emerald-ink)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal], color: 'var(--color-home-icon-amber-ink)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--color-text-muted)' },
  { tag: tags.invalid, color: 'var(--color-form-message-error)' },
]);

/**
 * Unquotes a JSON string token when it is syntactically valid.
 *
 * @param rawToken Raw document token.
 * @returns Parsed string or null when the token cannot be decoded.
 */
const decodeJsonStringToken = (rawToken: string): string | null => {
  try {
    const parsed = JSON.parse(rawToken);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Creates a stable diagnostic range even for zero-width parser error nodes.
 *
 * @param from Start offset reported by parser or schema validation.
 * @param to End offset reported by parser or schema validation.
 * @param docLength Current document length.
 * @returns Diagnostic range clamped to the document.
 */
const createDiagnosticRange = (from: number, to: number, docLength: number): { from: number; to: number } => {
  const clampedFrom = Math.max(0, Math.min(from, docLength));
  const clampedTo = Math.max(clampedFrom, Math.min(to, docLength));
  if (clampedTo > clampedFrom) {
    return { from: clampedFrom, to: clampedTo };
  }

  return {
    from: clampedFrom,
    to: Math.min(docLength, clampedFrom + 1),
  };
};

/**
 * Creates a CodeMirror diagnostic using the shared settings-schema source label.
 *
 * @param from Start document offset.
 * @param to End document offset.
 * @param message User-facing diagnostic text.
 * @param docLength Current document length.
 * @returns CodeMirror diagnostic.
 */
const createDiagnostic = (from: number, to: number, message: string, docLength: number): Diagnostic => {
  const range = createDiagnosticRange(from, to, docLength);
  return {
    from: range.from,
    message,
    severity: 'error',
    source: SETTINGS_JSON_LINT_SOURCE,
    to: range.to,
  };
};

/**
 * Builds a JSON AST index from CodeMirror's JSON parse tree.
 *
 * @param view CodeMirror editor view.
 * @returns JSON AST root plus parser diagnostics.
 */
const buildDocumentIndex = (state: EditorView['state']): SettingsJsonDocumentIndex => {
  const doc = state.doc;
  const docLength = doc.length;
  const syntaxErrors: Diagnostic[] = [];

  /**
   * Reads document text for a syntax node.
   *
   * @param node Syntax node.
   * @returns Node source text.
   */
  const readNodeText = (node: SyntaxNode): string => doc.sliceString(node.from, node.to);

  /**
   * Returns whether a syntax node can represent a JSON value.
   *
   * @param node Syntax node.
   * @returns Whether the node is a JSON value node.
   */
  const isJsonValueSyntaxNode = (node: SyntaxNode): boolean => {
    return ['Array', 'False', 'Null', 'Number', 'Object', 'String', 'True'].includes(node.name);
  };

  /**
   * Converts a syntax node into the local JSON AST shape.
   *
   * @param node Syntax node to convert.
   * @param parent Parent JSON AST node.
   * @returns JSON AST node or null for punctuation and unsupported nodes.
   */
  const buildNode = (node: SyntaxNode, parent?: JsonAstNode): JsonAstNode | null => {
    if (node.type.isError || node.name === '⚠') {
      syntaxErrors.push(
        createDiagnostic(node.from, node.to, t('settingsEditor.schema.diagnostics.invalidSyntax'), docLength),
      );
      return null;
    }

    if (node.name === 'Object') {
      const astNode: JsonAstNode = {
        children: [],
        from: node.from,
        kind: 'object',
        node,
        parent,
        to: node.to,
        value: {},
      };
      const properties: Record<string, unknown> = {};
      const cursor = node.cursor();

      if (cursor.firstChild()) {
        do {
          const child = cursor.node;
          if (child.name !== 'Property') {
            if (child.type.isError || child.name === '⚠') {
              syntaxErrors.push(
                createDiagnostic(child.from, child.to, t('settingsEditor.schema.diagnostics.invalidSyntax'), docLength),
              );
            }
            continue;
          }

          const property = buildNode(child, astNode);
          if (!property) {
            continue;
          }

          astNode.children.push(property);
          if (property.key !== undefined) {
            properties[property.key] = property.valueNode?.value;
          }
        } while (cursor.nextSibling());
      }

      astNode.value = properties;
      return astNode;
    }

    if (node.name === 'Array') {
      const astNode: JsonAstNode = {
        children: [],
        from: node.from,
        kind: 'array',
        node,
        parent,
        to: node.to,
        value: [],
      };
      const values: unknown[] = [];
      const cursor = node.cursor();

      if (cursor.firstChild()) {
        do {
          const child = cursor.node;
          const valueNode = buildNode(child, astNode);
          if (!valueNode) {
            if (child.type.isError || child.name === '⚠') {
              syntaxErrors.push(
                createDiagnostic(child.from, child.to, t('settingsEditor.schema.diagnostics.invalidSyntax'), docLength),
              );
            }
            continue;
          }

          astNode.children.push(valueNode);
          values.push(valueNode.value);
        } while (cursor.nextSibling());
      }

      astNode.value = values;
      return astNode;
    }

    if (node.name === 'Property') {
      const cursor = node.cursor();
      let keyNode: SyntaxNode | null = null;
      let valueSyntaxNode: SyntaxNode | null = null;

      if (cursor.firstChild()) {
        do {
          const child = cursor.node;
          if (child.name === 'PropertyName') {
            keyNode = child;
            continue;
          }

          if (isJsonValueSyntaxNode(child)) {
            valueSyntaxNode = child;
            continue;
          }

          if (child.type.isError || child.name === '⚠') {
            syntaxErrors.push(
              createDiagnostic(child.from, child.to, t('settingsEditor.schema.diagnostics.invalidSyntax'), docLength),
            );
          }
        } while (cursor.nextSibling());
      }

      if (!keyNode) {
        return null;
      }

      const key = decodeJsonStringToken(readNodeText(keyNode));
      const astNode: JsonAstNode = {
        children: [],
        from: node.from,
        key: key ?? undefined,
        keyFrom: keyNode.from + 1,
        keyTo: Math.max(keyNode.from + 1, keyNode.to - 1),
        kind: 'property',
        node,
        parent,
        to: node.to,
      };

      if (valueSyntaxNode) {
        const valueNode = buildNode(valueSyntaxNode, astNode);
        if (valueNode) {
          astNode.value = valueNode.value;
          astNode.valueNode = valueNode;
          astNode.children.push(valueNode);
        }
      }

      return astNode;
    }

    if (node.name === 'String') {
      return {
        children: [],
        from: node.from,
        kind: 'string',
        node,
        parent,
        to: node.to,
        value: decodeJsonStringToken(readNodeText(node)),
      };
    }

    if (node.name === 'Number') {
      return {
        children: [],
        from: node.from,
        kind: 'number',
        node,
        parent,
        to: node.to,
        value: Number(readNodeText(node)),
      };
    }

    if (node.name === 'True' || node.name === 'False') {
      return {
        children: [],
        from: node.from,
        kind: 'boolean',
        node,
        parent,
        to: node.to,
        value: node.name === 'True',
      };
    }

    if (node.name === 'Null') {
      return {
        children: [],
        from: node.from,
        kind: 'null',
        node,
        parent,
        to: node.to,
        value: null,
      };
    }

    return null;
  };

  const rootSyntaxNode = syntaxTree(state).topNode;
  let root: JsonAstNode | null = null;
  const cursor = rootSyntaxNode.cursor();

  if (cursor.firstChild()) {
    do {
      const child = cursor.node;
      const astNode = buildNode(child);
      if (astNode) {
        root = astNode;
      } else if (child.type.isError || child.name === '⚠') {
        syntaxErrors.push(
          createDiagnostic(child.from, child.to, t('settingsEditor.schema.diagnostics.invalidSyntax'), docLength),
        );
      }
    } while (cursor.nextSibling());
  }

  return { root, syntaxErrors };
};

/**
 * Returns whether the AST node value matches a JSON schema type.
 *
 * @param node JSON AST node.
 * @param type Schema type name.
 * @returns Whether the value matches.
 */
const isNodeCompatibleWithType = (node: JsonAstNode, type: JsonSchemaNode['type']): boolean => {
  if (!type) {
    return true;
  }

  if (type === 'integer') {
    return node.kind === 'number' && Number.isInteger(node.value);
  }

  return node.kind === type;
};

/**
 * Formats a schema value for user-facing diagnostics and completion detail.
 *
 * @param value Schema value.
 * @returns Compact string representation.
 */
const formatSchemaValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value) ?? String(value);
};

/**
 * Formats a schema value as an insertable JSON literal.
 *
 * @param value Schema value.
 * @returns Strict JSON literal text.
 */
const formatJsonLiteral = (value: unknown): string => {
  return JSON.stringify(value) ?? 'null';
};

type SchemaDetailLine = {
  label: string;
  value: string;
};

/**
 * Returns a localized schema type label.
 *
 * @param schema JSON schema node.
 * @returns Localized schema type label.
 */
const formatSchemaType = (schema: JsonSchemaNode): string => {
  if (schema.enum && schema.enum.length > 0) {
    return t('settingsEditor.schema.types.enum');
  }

  return t(`settingsEditor.schema.types.${schema.type ?? 'value'}`);
};

/**
 * Formats a settings schema title for tooltip and completion info.
 *
 * @param schema JSON schema node.
 * @param fallbackTitle Fallback label when the schema has no title.
 * @returns Display title.
 */
const formatSchemaTitle = (schema: JsonSchemaNode, fallbackTitle?: string): string => {
  return schema.title ?? fallbackTitle ?? formatSchemaType(schema);
};

/**
 * Builds localized schema detail rows for hover and completion info.
 *
 * @param schema JSON schema node.
 * @returns Detail rows.
 */
const buildSchemaDetailLines = (schema: JsonSchemaNode): SchemaDetailLine[] => {
  const details: SchemaDetailLine[] = [
    {
      label: t('settingsEditor.schema.labels.type'),
      value: formatSchemaType(schema),
    },
  ];

  if (schema.default !== undefined) {
    details.push({
      label: t('settingsEditor.schema.labels.default'),
      value: formatJsonLiteral(schema.default),
    });
  }

  if (schema.enum && schema.enum.length > 0) {
    details.push({
      label: t('settingsEditor.schema.labels.enum'),
      value: schema.enum.map(formatSchemaValue).join(', '),
    });
  }

  if (schema.minimum !== undefined || schema.maximum !== undefined) {
    details.push({
      label: t('settingsEditor.schema.labels.range'),
      value: t('settingsEditor.schema.range', {
        max: schema.maximum ?? t('settingsEditor.schema.unboundedMaximum'),
        min: schema.minimum ?? t('settingsEditor.schema.unboundedMinimum'),
      }),
    });
  }

  if (schema.maxLength !== undefined) {
    details.push({
      label: t('settingsEditor.schema.labels.maxLength'),
      value: String(schema.maxLength),
    });
  }

  if (schema.minItems !== undefined) {
    details.push({
      label: t('settingsEditor.schema.labels.minItems'),
      value: String(schema.minItems),
    });
  }

  return details;
};

/**
 * Recursively validates a JSON AST node against the supported settings schema subset.
 *
 * @param node JSON AST node to validate.
 * @param schema Schema node for the value.
 * @param diagnostics Mutable diagnostic collection.
 * @param docLength Current document length.
 * @returns Nothing.
 */
const validateNodeAgainstSchema = (
  node: JsonAstNode,
  schema: JsonSchemaNode,
  diagnostics: Diagnostic[],
  docLength: number,
): void => {
  if (!isNodeCompatibleWithType(node, schema.type)) {
    diagnostics.push(
      createDiagnostic(
        node.from,
        node.to,
        t('settingsEditor.schema.diagnostics.expectedType', { type: formatSchemaType(schema) }),
        docLength,
      ),
    );
    return;
  }

  if (schema.enum && !schema.enum.some((option) => option === node.value)) {
    diagnostics.push(
      createDiagnostic(
        node.from,
        node.to,
        t('settingsEditor.schema.diagnostics.expectedEnum', { options: schema.enum.map(formatSchemaValue).join(', ') }),
        docLength,
      ),
    );
  }

  if (node.kind === 'number') {
    const numericValue = typeof node.value === 'number' ? node.value : Number.NaN;
    if (schema.minimum !== undefined && numericValue < schema.minimum) {
      diagnostics.push(
        createDiagnostic(
          node.from,
          node.to,
          t('settingsEditor.schema.diagnostics.minimum', { min: schema.minimum }),
          docLength,
        ),
      );
    }

    if (schema.maximum !== undefined && numericValue > schema.maximum) {
      diagnostics.push(
        createDiagnostic(
          node.from,
          node.to,
          t('settingsEditor.schema.diagnostics.maximum', { max: schema.maximum }),
          docLength,
        ),
      );
    }
  }

  if (node.kind === 'string' && schema.maxLength !== undefined && typeof node.value === 'string') {
    if (node.value.length > schema.maxLength) {
      diagnostics.push(
        createDiagnostic(
          node.from,
          node.to,
          t('settingsEditor.schema.diagnostics.maxLength', { limit: schema.maxLength }),
          docLength,
        ),
      );
    }
  }

  if (node.kind === 'array') {
    if (schema.minItems !== undefined && node.children.length < schema.minItems) {
      diagnostics.push(
        createDiagnostic(
          node.from,
          node.to,
          t('settingsEditor.schema.diagnostics.minItems', { count: schema.minItems }),
          docLength,
        ),
      );
    }

    if (schema.items) {
      node.children.forEach((item) =>
        validateNodeAgainstSchema(item, schema.items as JsonSchemaNode, diagnostics, docLength),
      );
    }
  }

  if (node.kind !== 'object') {
    return;
  }

  const objectProperties = node.children.filter((child) => child.kind === 'property');
  const seenKeys = new Map<string, JsonAstNode>();

  objectProperties.forEach((propertyNode) => {
    if (propertyNode.key === undefined) {
      return;
    }

    const previous = seenKeys.get(propertyNode.key);
    if (previous) {
      diagnostics.push(
        createDiagnostic(
          propertyNode.keyFrom ?? propertyNode.from,
          propertyNode.keyTo ?? propertyNode.to,
          t('settingsEditor.schema.diagnostics.duplicateProperty', { key: propertyNode.key }),
          docLength,
        ),
      );
    }

    seenKeys.set(propertyNode.key, propertyNode);
  });

  schema.required?.forEach((requiredKey) => {
    if (!seenKeys.has(requiredKey)) {
      diagnostics.push(
        createDiagnostic(
          node.from,
          Math.min(node.from + 1, node.to),
          t('settingsEditor.schema.diagnostics.missingProperty', { key: requiredKey }),
          docLength,
        ),
      );
    }
  });

  objectProperties.forEach((propertyNode) => {
    if (propertyNode.key === undefined) {
      return;
    }

    const propertySchema = schema.properties?.[propertyNode.key];
    if (!propertySchema) {
      if (schema.additionalProperties === false) {
        diagnostics.push(
          createDiagnostic(
            propertyNode.keyFrom ?? propertyNode.from,
            propertyNode.keyTo ?? propertyNode.to,
            t('settingsEditor.schema.diagnostics.unknownProperty', { key: propertyNode.key }),
            docLength,
          ),
        );
      }
      return;
    }

    if (propertyNode.valueNode) {
      validateNodeAgainstSchema(propertyNode.valueNode, propertySchema, diagnostics, docLength);
    }
  });
};

/**
 * Lints the settings JSON document against syntax rules and the settings schema subset.
 *
 * @param view CodeMirror editor view.
 * @param schema Settings JSON schema.
 * @returns CodeMirror diagnostics.
 */
export const lintSettingsJsonDocument = (view: EditorView, schema: JsonSchemaDocument): readonly Diagnostic[] => {
  const index = buildDocumentIndex(view.state);
  if (index.syntaxErrors.length > 0) {
    return index.syntaxErrors;
  }

  if (!index.root) {
    return [
      createDiagnostic(
        0,
        view.state.doc.length,
        t('settingsEditor.schema.diagnostics.rootObject'),
        view.state.doc.length,
      ),
    ];
  }

  const diagnostics: Diagnostic[] = [];
  validateNodeAgainstSchema(index.root, schema, diagnostics, view.state.doc.length);
  return diagnostics;
};

/**
 * Returns the innermost JSON AST node containing a document position.
 *
 * @param node JSON AST root.
 * @param position Document position.
 * @returns Innermost matching node or null.
 */
const findAstNodeAtPosition = (node: JsonAstNode | null, position: number): JsonAstNode | null => {
  if (!node || position < node.from || position > node.to) {
    return null;
  }

  for (const child of node.children) {
    const match = findAstNodeAtPosition(child, position);
    if (match) {
      return match;
    }
  }

  return node;
};

/**
 * Returns the schema node for a path in the settings JSON document.
 *
 * @param rootSchema Root settings schema.
 * @param path JSON path.
 * @returns Schema context when found.
 */
const resolveSchemaContext = (
  rootSchema: JsonSchemaDocument,
  path: JsonPathSegment[],
): SettingsSchemaContext | null => {
  let currentSchema: JsonSchemaNode = rootSchema;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!currentSchema.items) {
        return null;
      }

      currentSchema = currentSchema.items;
      continue;
    }

    if (!currentSchema.properties?.[segment]) {
      return null;
    }

    currentSchema = currentSchema.properties[segment];
  }

  return { path, schema: currentSchema };
};

/**
 * Resolves the JSON path for one AST node.
 *
 * @param node JSON AST node.
 * @returns Path segments from document root to the node.
 */
const resolveAstPath = (node: JsonAstNode): JsonPathSegment[] => {
  const segments: JsonPathSegment[] = [];
  let current: JsonAstNode | undefined = node;

  while (current) {
    if (current.kind === 'property' && current.key !== undefined) {
      segments.unshift(current.key);
    } else if (current.parent?.kind === 'array') {
      const index = current.parent.children.indexOf(current);
      if (index >= 0) {
        segments.unshift(index);
      }
    }

    current = current.parent;
  }

  return segments;
};

/**
 * Returns existing object property keys for completion de-duplication.
 *
 * @param objectNode JSON object node.
 * @returns Set of property keys.
 */
const collectObjectKeys = (objectNode: JsonAstNode): Set<string> => {
  const keys = new Set<string>();
  objectNode.children.forEach((child) => {
    if (child.kind === 'property' && child.key !== undefined) {
      keys.add(child.key);
    }
  });
  return keys;
};

/**
 * Builds a DOM block for completion info and hover tooltip details.
 *
 * @param schema Schema node to describe.
 * @param title Optional display title.
 * @returns Tooltip DOM.
 */
const createSchemaInfoDom = (schema: JsonSchemaNode, title?: string): HTMLElement => {
  const root = document.createElement('div');
  root.className = 'cosmosh-settings-json-tooltip';

  const heading = document.createElement('div');
  heading.className = 'cosmosh-settings-json-tooltip-title';
  heading.textContent = formatSchemaTitle(schema, title);
  root.appendChild(heading);

  if (schema.description) {
    const description = document.createElement('div');
    description.className = 'cosmosh-settings-json-tooltip-description';
    description.textContent = schema.description;
    root.appendChild(description);
  }

  const details = buildSchemaDetailLines(schema);
  if (details.length > 0) {
    const detailList = document.createElement('dl');
    detailList.className = 'cosmosh-settings-json-tooltip-details';

    details.forEach((detail) => {
      const row = document.createElement('div');
      row.className = 'cosmosh-settings-json-tooltip-detail-row';

      const label = document.createElement('dt');
      label.className = 'cosmosh-settings-json-tooltip-detail-label';
      label.textContent = detail.label;

      const value = document.createElement('dd');
      value.className = 'cosmosh-settings-json-tooltip-detail-value';
      value.textContent = detail.value;

      row.append(label, value);
      detailList.appendChild(row);
    });

    root.appendChild(detailList);
  }

  return root;
};

/**
 * Returns the default JSON insertion text for one schema node.
 *
 * @param schema Schema node.
 * @returns JSON snippet text.
 */
const resolveDefaultInsertion = (schema: JsonSchemaNode): string => {
  if (schema.default !== undefined) {
    return JSON.stringify(schema.default, null, 2);
  }

  if (schema.enum?.[0] !== undefined) {
    return JSON.stringify(schema.enum[0]);
  }

  if (schema.type === 'boolean') {
    return 'false';
  }

  if (schema.type === 'integer') {
    return String(schema.minimum ?? 0);
  }

  if (schema.type === 'array') {
    return '[]';
  }

  if (schema.type === 'object') {
    return '{}';
  }

  return '""';
};

/**
 * Builds property completions for a JSON object schema.
 *
 * @param schema Object schema.
 * @param existingKeys Existing property keys in the object.
 * @returns CodeMirror completions.
 */
const buildPropertyCompletions = (schema: JsonSchemaNode, existingKeys: Set<string>): Completion[] => {
  return Object.entries(schema.properties ?? {})
    .filter(([key]) => !existingKeys.has(key))
    .map(([key, propertySchema]) => ({
      apply: `"${key}": ${resolveDefaultInsertion(propertySchema)}`,
      detail: formatSchemaType(propertySchema),
      info: () => createSchemaInfoDom(propertySchema, key),
      label: key,
      type: 'property',
    }));
};

/**
 * Builds value completions for enum and primitive schema values.
 *
 * @param schema Schema node.
 * @returns CodeMirror completions.
 */
const buildValueCompletions = (schema: JsonSchemaNode): Completion[] => {
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum.map((option) => ({
      apply: formatJsonLiteral(option),
      detail: formatSchemaType(schema),
      label: formatSchemaValue(option),
      type: 'constant',
    }));
  }

  if (schema.type === 'boolean') {
    return [
      { apply: 'true', detail: formatSchemaType(schema), label: 'true', type: 'constant' },
      { apply: 'false', detail: formatSchemaType(schema), label: 'false', type: 'constant' },
    ];
  }

  if (schema.default !== undefined) {
    return [
      {
        apply: resolveDefaultInsertion(schema),
        detail: t('settingsEditor.schema.labels.default'),
        label: resolveDefaultInsertion(schema),
        type: 'constant',
      },
    ];
  }

  return [];
};

/**
 * Finds the closest ancestor with the requested JSON AST node kind.
 *
 * @param node Starting node.
 * @param kind Requested node kind.
 * @returns Matching ancestor or null.
 */
const findAncestorByKind = (node: JsonAstNode | null, kind: JsonAstNodeKind): JsonAstNode | null => {
  let current: JsonAstNode | undefined = node ?? undefined;
  while (current) {
    if (current.kind === kind) {
      return current;
    }

    current = current.parent;
  }

  return null;
};

/**
 * Determines whether a cursor is positioned where an object key can be completed.
 *
 * @param syntaxNode Current CodeMirror syntax node.
 * @returns Whether property-name completions should be offered.
 */
const isPropertyNamePosition = (syntaxNode: SyntaxNode): boolean => {
  return syntaxNode.name === 'PropertyName' || syntaxNode.name === 'Object' || syntaxNode.name === '⚠';
};

/**
 * Returns the property whose value is being edited at the cursor.
 *
 * @param astNode JSON AST node at the cursor.
 * @param position Current document position.
 * @param state Current editor state.
 * @returns Matching property node or null.
 */
const findValueCompletionProperty = (
  astNode: JsonAstNode | null,
  position: number,
  state: EditorView['state'],
): JsonAstNode | null => {
  const propertyNode = astNode?.kind === 'property' ? astNode : findAncestorByKind(astNode, 'property');
  if (!propertyNode || propertyNode.key === undefined || position <= (propertyNode.keyTo ?? propertyNode.from)) {
    return null;
  }

  const propertyPrefix = state.doc.sliceString(propertyNode.from, position);
  return propertyPrefix.includes(':') ? propertyNode : null;
};

/**
 * Resolves the text range replaced by a completion candidate.
 *
 * @param context CodeMirror completion context.
 * @returns Replacement range, including a trailing quote when completing inside a JSON string.
 */
const resolveCompletionReplaceRange = (context: CompletionContext): { from: number; to: number } => {
  const token = context.matchBefore(/"?[\w.-]*"?/);
  const nextChar = context.state.doc.sliceString(context.pos, context.pos + 1);
  const shouldConsumeTrailingQuote = token?.text.startsWith('"') === true && nextChar === '"';

  return {
    from: token?.from ?? context.pos,
    to: shouldConsumeTrailingQuote ? context.pos + 1 : context.pos,
  };
};

/**
 * Builds a completion result for schema-driven values.
 *
 * @param context CodeMirror completion context.
 * @param schemaContext Schema node for the value being edited.
 * @returns Completion result or null.
 */
const buildValueCompletionResult = (
  context: CompletionContext,
  schemaContext: SettingsSchemaContext,
): CompletionResult | null => {
  const options = buildValueCompletions(schemaContext.schema);
  if (options.length === 0) {
    return null;
  }

  return {
    ...resolveCompletionReplaceRange(context),
    options,
    validFor: /^"?[\w.-]*"?$/,
  };
};

/**
 * Provides schema-driven completions for settings JSON.
 *
 * @param context CodeMirror completion context.
 * @param schema Settings schema.
 * @returns Completion result or null.
 */
export const completeSettingsJson = (
  context: CompletionContext,
  schema: JsonSchemaDocument,
): CompletionResult | null => {
  const index = buildDocumentIndex(context.state);
  const cursor = syntaxTree(context.state).resolveInner(context.pos, -1);
  const astNode = findAstNodeAtPosition(index.root, context.pos);

  const valueCompletionProperty = findValueCompletionProperty(astNode, context.pos, context.state);
  if (valueCompletionProperty) {
    const schemaContext = resolveSchemaContext(schema, resolveAstPath(valueCompletionProperty));
    if (schemaContext) {
      return buildValueCompletionResult(context, schemaContext);
    }
  }

  if (isPropertyNamePosition(cursor)) {
    const objectNode = findAncestorByKind(astNode, 'object') ?? index.root;
    if (!objectNode || objectNode.kind !== 'object') {
      return null;
    }

    const objectPath = resolveAstPath(objectNode);
    const schemaContext = resolveSchemaContext(schema, objectPath);
    if (!schemaContext) {
      return null;
    }

    return {
      ...resolveCompletionReplaceRange(context),
      options: buildPropertyCompletions(schemaContext.schema, collectObjectKeys(objectNode)),
      validFor: /^"?[\w.-]*"?$/,
    };
  }

  const valueNode = astNode?.kind === 'property' ? astNode.valueNode : astNode;
  if (!valueNode) {
    return null;
  }

  const schemaContext = resolveSchemaContext(schema, resolveAstPath(valueNode));
  if (!schemaContext) {
    return null;
  }

  return buildValueCompletionResult(context, schemaContext);
};

/**
 * Builds a schema hover tooltip for the JSON node at the current pointer position.
 *
 * @param view CodeMirror editor view.
 * @param position Document position.
 * @param schema Settings schema.
 * @returns Tooltip or null.
 */
export const createSettingsJsonHoverTooltip = (
  view: EditorView,
  position: number,
  schema: JsonSchemaDocument,
): Tooltip | null => {
  const index = buildDocumentIndex(view.state);
  const astNode = findAstNodeAtPosition(index.root, position);
  if (!astNode) {
    return null;
  }

  const propertyNode = astNode.kind === 'property' ? astNode : findAncestorByKind(astNode, 'property');
  const valueNode = astNode.kind === 'property' ? astNode.valueNode : astNode;
  const targetNode = astNode.kind === 'property' ? astNode : (valueNode ?? astNode);
  const schemaContext = resolveSchemaContext(schema, resolveAstPath(targetNode));
  if (!schemaContext) {
    return null;
  }

  const from =
    propertyNode?.keyFrom && position >= propertyNode.keyFrom && position <= (propertyNode.keyTo ?? 0)
      ? propertyNode.keyFrom
      : targetNode.from;
  const to = propertyNode?.keyTo && from === propertyNode.keyFrom ? propertyNode.keyTo : targetNode.to;
  const title = propertyNode?.key ?? String(schemaContext.path.at(-1) ?? schema.title);

  return {
    above: true,
    create: () => ({
      dom: createSchemaInfoDom(schemaContext.schema, title),
    }),
    end: to,
    pos: from,
  };
};

/**
 * Creates CodeMirror extensions for the settings JSON language experience.
 *
 * @param schema Settings JSON schema.
 * @returns Extensions for JSON parsing, linting, completion, hover, and highlighting.
 */
export const createSettingsJsonLanguageExtensions = (schema: JsonSchemaDocument): Extension[] => [
  json(),
  syntaxHighlighting(settingsJsonHighlightStyle),
  lintGutter(),
  linter((view) => lintSettingsJsonDocument(view, schema), { delay: 250 }),
  autocompletion({
    override: [(context) => completeSettingsJson(context, schema)],
  }),
  hoverTooltip((view, position) => createSettingsJsonHoverTooltip(view, position, schema)),
  tooltips({
    position: 'fixed',
  }),
];

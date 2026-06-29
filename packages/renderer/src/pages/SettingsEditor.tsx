import { normalizeSettingsValuesStrict, type SettingsValues, type SettingValidationError } from '@cosmosh/api-contract';
import { Save } from 'lucide-react';
import React from 'react';

import { Button } from '../components/ui/button';
import { Menubar } from '../components/ui/menubar';
import { type AppSettingsScope } from '../lib/app-settings';
import { getAppSettings, updateAppSettings } from '../lib/backend';
import { onLocaleChange, t } from '../lib/i18n';
import { updateSettingsStoreValues, useSettingsValue } from '../lib/settings-store';
import { useToast } from '../lib/toast-context';
import {
  SettingsJsonCodeMirrorEditor,
  type SettingsJsonCodeMirrorEditorHandle,
} from './settings-editor/SettingsJsonCodeMirrorEditor';
import { type JsonSchemaDocument, type JsonSchemaNode } from './settings-editor/settingsJsonLanguage';
import { type SettingDefinition, SETTINGS_REGISTRY } from './settings-registry';

const stringifySettings = (values: SettingsValues): string => {
  return `${JSON.stringify(values, null, 2)}\n`;
};

const formatValidationError = (error: SettingValidationError): string => {
  try {
    const params: Record<string, string | number> = { ...error.params };
    if (typeof params.nameI18nKey === 'string') {
      params.name = t(params.nameI18nKey as string);
    }

    return t(error.i18nKey, params);
  } catch {
    return error.fallbackMessage;
  }
};

const buildSettingPropertySchema = (item: SettingDefinition): JsonSchemaNode => {
  const settingName = t(item.nameI18nKey);
  const settingDescription = t(item.descriptionI18nKey);

  const base: JsonSchemaNode = {
    title: `${settingName} (${item.key})`,
    description: settingDescription,
    markdownDescription: `**${settingName}**\n\n${settingDescription}`,
    default: item.defaultValue,
  };

  if (item.control === 'json') {
    return {
      ...item.jsonSchema,
      ...base,
    };
  }

  if (item.valueType === 'boolean') {
    return {
      ...base,
      type: 'boolean',
    };
  }

  if (item.valueType === 'number') {
    return {
      ...base,
      type: 'integer',
      minimum: item.min,
      maximum: item.max,
    };
  }

  return {
    ...base,
    type: 'string',
    enum: item.options?.map((option) => option.value),
    maxLength: item.maxLength,
  };
};

const buildSettingsSchema = (): JsonSchemaDocument => {
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];

  SETTINGS_REGISTRY.forEach((item) => {
    properties[item.key] = buildSettingPropertySchema(item);
    required.push(item.key);
  });

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: t('settingsEditor.schemaTitle'),
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
};

const parseSettingsJson = (rawJson: string): { value?: SettingsValues; error?: string } => {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawJson);
  } catch {
    return { error: t('settingsEditor.invalidJson') };
  }

  const normalized = normalizeSettingsValuesStrict(parsedJson);
  if (!normalized.value) {
    return {
      error: normalized.error ? formatValidationError(normalized.error) : t('settingsEditor.validationFailed'),
    };
  }

  return { value: normalized.value };
};

const SettingsEditor: React.FC<{ initialSettingKey?: string }> = ({ initialSettingKey }) => {
  const { error: notifyError, success: notifySuccess, warning: notifyWarning } = useToast();
  const [schema, setSchema] = React.useState<JsonSchemaDocument>(() => buildSettingsSchema());
  const terminalFontFamily = useSettingsValue('terminalFontFamily');
  const revealedInitialSettingKeyRef = React.useRef<string | null>(null);
  const editorRef = React.useRef<SettingsJsonCodeMirrorEditorHandle | null>(null);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [isSaving, setIsSaving] = React.useState<boolean>(false);
  const [scope, setScope] = React.useState<AppSettingsScope>({ deviceId: 'local-device' });
  const [rawJson, setRawJson] = React.useState<string>('{}\n');
  const [savedJson, setSavedJson] = React.useState<string>('{}\n');

  React.useEffect(() => {
    return onLocaleChange(() => {
      setSchema(buildSettingsSchema());
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      setIsLoading(true);

      try {
        const response = await getAppSettings();
        if (cancelled) {
          return;
        }

        const nextRawJson = stringifySettings(response.data.item.values);
        setScope(response.data.item.scope);
        setRawJson(nextRawJson);
        setSavedJson(nextRawJson);
      } catch (error: unknown) {
        if (!cancelled) {
          notifyError(error instanceof Error ? error.message : t('settingsEditor.loadFailed'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [notifyError]);

  const hasChanges = rawJson !== savedJson;

  const revealSettingKey = React.useCallback((settingKey: string): boolean => {
    return editorRef.current?.revealSettingKey(settingKey) ?? false;
  }, []);

  React.useEffect(() => {
    if (!initialSettingKey || isLoading || revealedInitialSettingKeyRef.current === initialSettingKey) {
      return;
    }

    let attempt = 0;
    let frameId = 0;

    const revealWhenReady = (): void => {
      attempt += 1;
      if (revealSettingKey(initialSettingKey)) {
        revealedInitialSettingKeyRef.current = initialSettingKey;
        return;
      }

      if (attempt < 3) {
        frameId = window.requestAnimationFrame(revealWhenReady);
      }
    };

    frameId = window.requestAnimationFrame(revealWhenReady);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [initialSettingKey, isLoading, revealSettingKey]);

  const handleSave = React.useCallback(async (): Promise<void> => {
    if (isSaving) {
      return;
    }

    const parsed = parseSettingsJson(rawJson);
    if (!parsed.value) {
      notifyWarning(parsed.error ?? t('settingsEditor.validationFailed'));
      return;
    }

    setIsSaving(true);

    try {
      const response = await updateAppSettings({
        scope,
        values: parsed.value,
      });

      const nextRawJson = stringifySettings(response.data.item.values);
      setScope(response.data.item.scope);
      setRawJson(nextRawJson);
      setSavedJson(nextRawJson);
      await updateSettingsStoreValues(response.data.item.values);
      notifySuccess(t('settingsEditor.saveSuccess'));
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : t('settingsEditor.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, notifyError, notifySuccess, notifyWarning, rawJson, scope]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="px-3 py-2">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h1 className="text-home-text text-[24px] font-semibold">{t('settingsEditor.title')}</h1>
          <Menubar>
            <Button
              disabled={isLoading || isSaving || !hasChanges}
              onClick={() => {
                void handleSave();
              }}
            >
              <Save className="h-4 w-4" />
              {isSaving ? t('settingsEditor.saving') : t('settingsEditor.save')}
            </Button>
          </Menubar>
        </div>
      </div>

      <div className="h-full w-full flex-1 overflow-hidden rounded-[18px] bg-ssh-card-bg-terminal">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-home-text-subtle">
            {t('settingsEditor.loading')}
          </div>
        ) : (
          <div className="h-full w-full overflow-hidden">
            <SettingsJsonCodeMirrorEditor
              fontFamily={terminalFontFamily}
              readOnly={isSaving}
              schema={schema}
              value={rawJson}
              onChange={setRawJson}
              onMount={(editor) => {
                editorRef.current = editor;
              }}
              onSave={handleSave}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsEditor;

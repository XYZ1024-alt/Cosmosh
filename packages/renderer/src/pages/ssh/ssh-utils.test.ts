import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calibrateAutocompleteCommandPrefix,
  containsTerminalControlContent,
  createTerminalPasteWarningRequest,
  flattenCommandForTerminalInput,
  reconcileSecondaryPaneRuntimes,
  resolveAutocompleteCommandPrefix,
  resolvePromptCommandStartOffset,
  resolveSftpDirectoryPathFromSelection,
  resolveTerminalPaneCloseTransition,
  shouldReconnectTerminalPaneOnActivation,
} from './ssh-utils';

const DEFAULT_PASTE_WARNING_SETTINGS = {
  warnOnMultiLinePaste: true,
  warnOnLargePaste: true,
  largePasteWarningThreshold: 8,
  warnOnControlCharactersPaste: true,
};

test('selection directory resolver accepts explicit remote paths', () => {
  assert.equal(resolveSftpDirectoryPathFromSelection('/'), '/');
  assert.equal(resolveSftpDirectoryPathFromSelection('/var/www/'), '/var/www');
  assert.equal(resolveSftpDirectoryPathFromSelection("'~/projects/site'"), '~/projects/site');
  assert.equal(resolveSftpDirectoryPathFromSelection('./logs,'), './logs');
  assert.equal(resolveSftpDirectoryPathFromSelection('file:///opt/app/current'), '/opt/app/current');
  assert.equal(resolveSftpDirectoryPathFromSelection('file:///tmp/%broken'), '/tmp/%broken');
});

test('selection directory resolver rejects ambiguous or unsafe values', () => {
  assert.equal(resolveSftpDirectoryPathFromSelection('var/www'), null);
  assert.equal(resolveSftpDirectoryPathFromSelection('https://example.com/path'), null);
  assert.equal(resolveSftpDirectoryPathFromSelection(''), null);
});

test('selection directory resolver resolves dot-relative paths from trusted pane cwd', () => {
  assert.equal(resolveSftpDirectoryPathFromSelection('./logs', '/srv/app'), '/srv/app/logs');
  assert.equal(resolveSftpDirectoryPathFromSelection('../shared/cache', '/srv/app/current'), '/srv/app/shared/cache');
  assert.equal(resolveSftpDirectoryPathFromSelection('../../../../etc', '/srv/app'), '/etc');
  assert.equal(resolveSftpDirectoryPathFromSelection('relative/path', '/srv/app'), null);
});

test('pane close transition promotes a surviving pane without changing its id', () => {
  assert.deepEqual(resolveTerminalPaneCloseTransition(['pane-1', 'pane-2', 'pane-3'], 'pane-1', 'pane-1'), {
    paneIds: ['pane-2', 'pane-3'],
    activePaneId: 'pane-2',
  });
  assert.deepEqual(resolveTerminalPaneCloseTransition(['pane-1', 'pane-2', 'pane-3'], 'pane-3', 'pane-2'), {
    paneIds: ['pane-1', 'pane-3'],
    activePaneId: 'pane-3',
  });
  assert.equal(resolveTerminalPaneCloseTransition(['pane-1'], 'pane-1', 'pane-1'), null);
});

test('pane activation starts a deferred primary session regardless of reconnect preference', () => {
  assert.equal(
    shouldReconnectTerminalPaneOnActivation({
      owner: 'primary',
      connectionState: 'connecting',
      socketReadyState: null,
      isFirstActivation: true,
      reconnectOnFocus: false,
    }),
    true,
  );
  assert.equal(
    shouldReconnectTerminalPaneOnActivation({
      owner: 'secondary',
      connectionState: 'failed',
      socketReadyState: null,
      isFirstActivation: true,
      reconnectOnFocus: true,
    }),
    false,
  );
});

test('pane activation reconnects every failed pane only when enabled', () => {
  assert.equal(
    shouldReconnectTerminalPaneOnActivation({
      owner: 'secondary',
      connectionState: 'failed',
      socketReadyState: WebSocket.CLOSED,
      isFirstActivation: false,
      reconnectOnFocus: true,
    }),
    true,
  );
  assert.equal(
    shouldReconnectTerminalPaneOnActivation({
      owner: 'primary',
      connectionState: 'failed',
      socketReadyState: WebSocket.CLOSED,
      isFirstActivation: false,
      reconnectOnFocus: false,
    }),
    false,
  );
  assert.equal(
    shouldReconnectTerminalPaneOnActivation({
      owner: 'secondary',
      connectionState: 'failed',
      socketReadyState: WebSocket.CONNECTING,
      isFirstActivation: false,
      reconnectOnFocus: true,
    }),
    false,
  );
});

test('pane reconciliation preserves siblings during primary retry and later prunes removed panes', () => {
  const disposeCounts = new Map<string, number>();
  const createRuntime = (paneId: string, owner: 'primary' | 'secondary') => ({
    owner,
    dispose: (): void => {
      disposeCounts.set(paneId, (disposeCounts.get(paneId) ?? 0) + 1);
    },
  });
  const runtimeMap = new Map([
    ['pane-1', createRuntime('pane-1', 'primary')],
    ['pane-2', createRuntime('pane-2', 'secondary')],
    ['pane-removed', createRuntime('pane-removed', 'secondary')],
  ]);

  reconcileSecondaryPaneRuntimes(runtimeMap, {
    desiredPaneIds: ['pane-1', 'pane-2'],
    isActive: true,
    sessionTargetReady: false,
  });

  assert.deepEqual([...runtimeMap.keys()], ['pane-1', 'pane-2', 'pane-removed']);
  assert.equal(disposeCounts.size, 0);

  reconcileSecondaryPaneRuntimes(runtimeMap, {
    desiredPaneIds: ['pane-1', 'pane-2'],
    isActive: true,
    sessionTargetReady: true,
  });

  assert.deepEqual([...runtimeMap.keys()], ['pane-1', 'pane-2']);
  assert.equal(disposeCounts.get('pane-removed'), 1);
  assert.equal(disposeCounts.has('pane-1'), false);
  assert.equal(disposeCounts.has('pane-2'), false);
});

test('paste warning request reports enabled paste safety reasons', () => {
  const request = createTerminalPasteWarningRequest('echo one\necho two', DEFAULT_PASTE_WARNING_SETTINGS);

  assert.ok(request);
  assert.deepEqual(request.reasons, ['multiLine', 'largeText']);
  assert.equal(request.threshold, 8);
  assert.equal(request.characterCount, 17);
  assert.equal(request.preview, 'echo one\necho two');
});

test('paste warning request detects terminal control content', () => {
  assert.equal(containsTerminalControlContent('\u001b[31mred\u001b[0m'), true);
  assert.equal(containsTerminalControlContent('title\u0007'), true);

  const request = createTerminalPasteWarningRequest('printf "\u001b[31m"', {
    ...DEFAULT_PASTE_WARNING_SETTINGS,
    warnOnMultiLinePaste: false,
    warnOnLargePaste: false,
  });

  assert.ok(request);
  assert.deepEqual(request.reasons, ['controlCharacters']);
});

test('paste warning request returns null when no enabled reason matches', () => {
  assert.equal(createTerminalPasteWarningRequest('echo ok', DEFAULT_PASTE_WARNING_SETTINGS), null);
  assert.equal(
    createTerminalPasteWarningRequest('echo one\necho two', {
      ...DEFAULT_PASTE_WARNING_SETTINGS,
      warnOnMultiLinePaste: false,
      warnOnLargePaste: false,
    }),
    null,
  );
});

test('prompt boundary skips virtual environment decoration only with shell prompt context', () => {
  const renderedInput = '(base) xyz10@DESKTOP:~$ sudo ss -tlnp | grep :22';
  const commandStartOffset = resolvePromptCommandStartOffset(renderedInput);

  assert.equal(renderedInput.slice(commandStartOffset), 'sudo ss -tlnp | grep :22');
  assert.equal(resolvePromptCommandStartOffset('(base) echo value'), 0);
});

test('prompt boundary strips through trailing status glyphs of glyph-led prompts', () => {
  const renderedInput = '➜  myrepo git:(main) ✗ ls -la';
  assert.equal(renderedInput.slice(resolvePromptCommandStartOffset(renderedInput)), 'ls -la');

  const promptOnly = '➜  myrepo git:(main) ✗';
  assert.equal(resolvePromptCommandStartOffset(promptOnly), promptOnly.length);
});

test('prompt boundary stops at shell operators inside command text', () => {
  const compound = 'user@host:~$ (cd /tmp && make)';
  assert.equal(compound.slice(resolvePromptCommandStartOffset(compound)), '(cd /tmp && make)');

  const redirect = '$ sort > out.txt';
  assert.equal(redirect.slice(resolvePromptCommandStartOffset(redirect)), 'sort > out.txt');
});

test('prompt boundary ignores ascii symbolic arguments', () => {
  const line = '$ ls -- *';
  assert.equal(line.slice(resolvePromptCommandStartOffset(line)), 'ls -- *');
});

test('autocomplete command prefix uses local shadow for normal typing', () => {
  assert.equal(resolveAutocompleteCommandPrefix('ec', 'echo'), 'echo');
});

test('autocomplete command prefix preserves recalled history command context', () => {
  assert.equal(
    resolveAutocompleteCommandPrefix('echo 1ec', 'ec', {
      localPrefixNeedsRenderedContext: true,
    }),
    'echo 1ec',
  );
});

test('autocomplete command prefix merges local suffix before terminal echo catches up', () => {
  assert.equal(
    resolveAutocompleteCommandPrefix('echo 1e', 'ec', {
      localPrefixNeedsRenderedContext: true,
    }),
    'echo 1ec',
  );
});

test('autocomplete command prefix uses trusted line-state cursor only when lengths agree', () => {
  assert.equal(
    calibrateAutocompleteCommandPrefix('git status --short', {
      lineLength: 18,
      cursorIndex: 10,
    }),
    'git status',
  );
  assert.equal(
    calibrateAutocompleteCommandPrefix('git status --short', {
      lineLength: 99,
      cursorIndex: 3,
    }),
    'git status --short',
  );
});

test('flatten keeps single-line commands untouched', () => {
  assert.equal(flattenCommandForTerminalInput('git status --short'), 'git status --short');
});

test('flatten joins retained continuation lines without submitting newlines', () => {
  assert.equal(flattenCommandForTerminalInput('cat <<EOF\n> line1\n> EOF'), 'cat <<EOF line1 EOF');
  assert.equal(flattenCommandForTerminalInput('echo start\r\n> --flag'), 'echo start --flag');
});

test('flatten strips zsh-style named continuation prompts on follow-up lines', () => {
  assert.equal(flattenCommandForTerminalInput("echo 'a\nquote> b'"), "echo 'a b'");
  assert.equal(flattenCommandForTerminalInput('ls |\npipe> wc -l'), 'ls | wc -l');
});

test('flatten preserves first-line content that resembles a continuation prompt', () => {
  assert.equal(flattenCommandForTerminalInput('sort > out.txt'), 'sort > out.txt');
  assert.equal(flattenCommandForTerminalInput('a\nb > c'), 'a b > c');
});

test('flatten drops blank continuation lines', () => {
  assert.equal(flattenCommandForTerminalInput('one\n\n> two\n   \n> three'), 'one two three');
});

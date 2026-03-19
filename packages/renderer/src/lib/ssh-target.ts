import { LOCAL_TERMINAL_TARGET_PREFIX, parseTerminalTarget, toLocalTerminalTargetId } from './ssh-connection-intent';

let shouldOpenSshEditorCreateMode = false;

export { LOCAL_TERMINAL_TARGET_PREFIX, parseTerminalTarget, toLocalTerminalTargetId };

export const requestSshEditorCreateMode = (): void => {
  shouldOpenSshEditorCreateMode = true;
};

export const consumeSshEditorCreateMode = (): boolean => {
  const shouldConsume = shouldOpenSshEditorCreateMode;
  shouldOpenSshEditorCreateMode = false;
  return shouldConsume;
};

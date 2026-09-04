/**
 * Reports whether any user-edited field still differs from its initial value.
 *
 * Form states covered by this helper are flat records whose values are primitives
 * or primitive arrays. Tracking edited keys keeps asynchronous form hydration from
 * being mistaken for a user change.
 *
 * @param initialState Form snapshot captured when the editor opened.
 * @param currentState Current form state.
 * @param editedFieldKeys Fields changed through user-facing form controls.
 * @returns Whether the editor contains unsaved user changes.
 */
export const hasUnsavedEditorChanges = <State extends object>(
  initialState: State,
  currentState: State,
  editedFieldKeys: ReadonlySet<keyof State>,
): boolean => {
  for (const fieldKey of editedFieldKeys) {
    const initialValue = initialState[fieldKey];
    const currentValue = currentState[fieldKey];

    if (Array.isArray(initialValue) && Array.isArray(currentValue)) {
      if (
        initialValue.length !== currentValue.length ||
        initialValue.some((value, index) => !Object.is(value, currentValue[index]))
      ) {
        return true;
      }
      continue;
    }

    if (!Object.is(initialValue, currentValue)) {
      return true;
    }
  }

  return false;
};

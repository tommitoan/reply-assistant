import type { OptionActions } from "./ReplyOptionCard";
import type { OptionFeedbackStore } from "./useOptionFeedback";

// Connects one option's feedback state to the actions its card shows. Returns
// undefined while the option is not known to the store (still streaming).
export function actionsFor(store: OptionFeedbackStore, id: string): OptionActions | undefined {
  const item = store.items[id];
  if (!item) return undefined;
  return {
    item,
    onRate: (rating) => void store.save(id, { rating }),
    onSaveEdit: (editedText) => store.save(id, { editedText }),
    onUse: () => {
      // Already marked; copying again needs no second save.
      if (!item.shown.chosen) void store.save(id, { chosen: true });
    },
    onDismissError: () => store.dismissError(id),
  };
}

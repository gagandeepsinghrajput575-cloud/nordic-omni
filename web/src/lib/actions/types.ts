/** Shared shape for every form action, so components can render feedback uniformly. */
export interface ActionState {
  ok: boolean;
  /** Human-readable failure. Never contains SQL. */
  error?: string;
  /** Which input to highlight, when the failure is field-specific. */
  field?: string;
  /** Success message, when the action does not redirect. */
  message?: string;
}

export const EMPTY_STATE: ActionState = { ok: false };

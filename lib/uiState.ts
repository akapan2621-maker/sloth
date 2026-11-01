/**
 * Per-account UI memory ("where did this login leave off").
 *
 * Stored in `localStorage` under the account id, so signing out and back in
 * - even after restarting the browser - restores the last opened chat, the
 * selected Space scope and the split-view layout for that account.
 */

import type { SpaceSelection } from "./types";

export interface WorkspaceUiState {
  activeChatId?: string | null;
  spaceSelection?: SpaceSelection;
  splitOpen?: boolean;
  /** Right (Spaces) panel width as a fraction of the split container. */
  splitRight?: number;
}

function keyFor(userId: string): string {
  return `aqw:ui-state:${userId}`;
}

export function readUiState(userId: string | null | undefined): WorkspaceUiState {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as WorkspaceUiState)
      : {};
  } catch {
    return {};
  }
}

export function writeUiState(
  userId: string | null | undefined,
  patch: WorkspaceUiState,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(
      keyFor(userId),
      JSON.stringify({ ...readUiState(userId), ...patch }),
    );
  } catch {
    /* storage unavailable */
  }
}

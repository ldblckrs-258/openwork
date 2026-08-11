"use memo";

import { useSessionActivityStore } from "@/react-app/domains/session/status/session-activity-store"
import type {
  ChatToolReconnectAction,
  ChatToolReconnectProgress,
  ChatToolReconnectResult,
} from "@/components/tools/error-attribution"
import type { RoleplayRenderContext } from "@/components/chat/roleplay-text"
import type { RoleplayTurnRecord } from "@openwork/types/roleplay"
import * as React from "react"

/**
 * Regenerate and alternative navigation for roleplay sessions.
 *
 * Rendered inside the message group's own action bar rather than as a second
 * toolbar above the composer: these act on the reply they sit under, which is
 * where the copy/branch/revert actions already live.
 */
export interface RoleplaySwipeControls {
  turn: RoleplayTurnRecord | null
  busy: boolean
  onSwipe: () => void
  onSelectAlternative: (offset: number) => void
}

interface MessageListContextValue {
  workspaceId: string
  sessionId: string
  showThinking: boolean
  highlightQuery?: string
  developerMode: boolean
  displaySuggestions: boolean
  providerConnectedCount: number
  dispatchAction: (action: DispatchAction) => void
  setPrompt: (prompt: string) => void
  onRevertToUserMessage: (messageId: string) => void
  onForkAtMessage: (messageId: string) => void
  onEditUserMessage: (messageId: string, text: string) => void
  onMcpReconnect: (
    action: ChatToolReconnectAction,
    onProgress: (progress: ChatToolReconnectProgress) => void,
  ) => Promise<ChatToolReconnectResult>
  onMcpReopenAuthorization: (action: ChatToolReconnectAction, authorizeUrl: string) => Promise<void>
  onMcpRetry: (action: ChatToolReconnectAction) => void | Promise<void>
  /** Null for ordinary chat sessions. */
  roleplaySwipe: RoleplaySwipeControls | null
  /**
   * Names for `{{char}}`/`{{user}}`, and the switch that turns on transcript
   * colouring. Null for ordinary chat sessions, which must keep rendering as
   * markdown.
   */
  roleplay: RoleplayRenderContext | null
}

const MessageListContext = React.createContext<MessageListContextValue | null>(null)

interface MessageListProviderProps {
  children: React.ReactNode
  workspaceId: string
  sessionId: string
  showThinking: boolean
  highlightQuery?: string
  developerMode: boolean
  onRevertToUserMessage: (messageId: string) => void
  onForkAtMessage: (messageId: string) => void
  onEditUserMessage: (messageId: string, text: string) => void
  onMcpReconnect: (
    action: ChatToolReconnectAction,
    onProgress: (progress: ChatToolReconnectProgress) => void,
  ) => Promise<ChatToolReconnectResult>
  onMcpReopenAuthorization: (action: ChatToolReconnectAction, authorizeUrl: string) => Promise<void>
  onMcpRetry: (action: ChatToolReconnectAction) => void | Promise<void>
  displaySuggestions: boolean
  providerConnectedCount: number
  dispatchAction: (action: DispatchAction) => void
  setPrompt: (prompt: string) => void
  roleplaySwipe?: RoleplaySwipeControls | null
  roleplay?: RoleplayRenderContext | null
}

export interface DispatchAction {
  target: "settings"
  action: "open"
  section: "commands" | "skills" | "mcps" | "plugins" | "providers"
}

export function MessageListProvider({
  children,
  workspaceId,
  sessionId,
  showThinking,
  highlightQuery,
  developerMode,
  displaySuggestions,
  providerConnectedCount,
  dispatchAction,
  setPrompt,
  onRevertToUserMessage,
  onForkAtMessage,
  onEditUserMessage,
  onMcpReconnect,
  onMcpReopenAuthorization,
  onMcpRetry,
  roleplaySwipe = null,
  roleplay = null,
}: MessageListProviderProps) {
  const value = React.useMemo(
    () => ({
      workspaceId,
      sessionId,
      showThinking,
      highlightQuery,
      developerMode,
      displaySuggestions,
      providerConnectedCount,
      dispatchAction,
      setPrompt,
      onRevertToUserMessage,
      onForkAtMessage,
      onEditUserMessage,
      onMcpReconnect,
      onMcpReopenAuthorization,
      onMcpRetry,
      roleplaySwipe,
      roleplay,
    }),
    [
      workspaceId,
      sessionId,
      showThinking,
      highlightQuery,
      developerMode,
      displaySuggestions,
      providerConnectedCount,
      dispatchAction,
      setPrompt,
      onRevertToUserMessage,
      onForkAtMessage,
      onEditUserMessage,
      onMcpReconnect,
      onMcpReopenAuthorization,
      onMcpRetry,
      roleplaySwipe,
      roleplay,
    ],
  )

  return (
    <MessageListContext.Provider value={value}>
      {children}
    </MessageListContext.Provider>
  )
}

export function useMessageList() {
  const context = React.useContext(MessageListContext)

  if (!context) {
    throw new Error("useMessageList must be used within a MessageListProvider")
  }

  return context
}

export function useSessionErrorMessage() {
  const { workspaceId, sessionId } = useMessageList();

  return useSessionActivityStore(state => state.getSessionError(workspaceId, sessionId));
}

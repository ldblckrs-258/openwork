"use memo";

import { useSessionActivityStore } from "@/react-app/domains/session/status/session-activity-store"
import type {
  ChatToolReconnectAction,
  ChatToolReconnectProgress,
  ChatToolReconnectResult,
} from "@/components/tools/error-attribution"
import type { RoleplayRenderContext } from "@/components/chat/roleplay-text"
import type { RoleplaySceneChangeRecord, RoleplayTurnRecord } from "@openwork/types/roleplay"
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
  /**
   * Re-run the turn that produced this assistant message.
   *
   * Every session has this, not just roleplay: the roleplay swipe path records
   * alternatives on top of it, but the underlying operation — revert to the
   * user message, send it again — is the same one edit-and-resend performs.
   */
  onRegenerate: (assistantMessageId: string) => void
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
  /**
   * What each reply changed about the scene, by that reply's message id.
   *
   * Empty for ordinary chat sessions and for roleplay sessions that track no
   * state. A message absent from the map is one nobody recorded changes for,
   * which is not the same as a reply that changed nothing — so the transcript
   * renders nothing rather than claiming the scene held still.
   */
  sceneChangesByMessage: Map<string, RoleplaySceneChangeRecord[]>
}

/** A stable identity, so an ordinary chat session does not rebuild the context every render. */
const EMPTY_SCENE_CHANGES: Map<string, RoleplaySceneChangeRecord[]> = new Map()

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
  /**
   * Re-run the turn that produced this assistant message.
   *
   * Every session has this, not just roleplay: the roleplay swipe path records
   * alternatives on top of it, but the underlying operation — revert to the
   * user message, send it again — is the same one edit-and-resend performs.
   */
  onRegenerate: (assistantMessageId: string) => void
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
  sceneChangesByMessage?: Map<string, RoleplaySceneChangeRecord[]>
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
  onRegenerate,
  onMcpReconnect,
  onMcpReopenAuthorization,
  onMcpRetry,
  roleplaySwipe = null,
  roleplay = null,
  sceneChangesByMessage = EMPTY_SCENE_CHANGES,
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
      onRegenerate,
      onMcpReconnect,
      onMcpReopenAuthorization,
      onMcpRetry,
      roleplaySwipe,
      roleplay,
      sceneChangesByMessage,
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
      onRegenerate,
      onMcpReconnect,
      onMcpReopenAuthorization,
      onMcpRetry,
      roleplaySwipe,
      roleplay,
      sceneChangesByMessage,
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

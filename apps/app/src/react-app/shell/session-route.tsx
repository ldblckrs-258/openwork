/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "@/components/ui/sonner";
import type {
  AgentPartInput,
  FilePartInput,
  ProviderListResponse,
  TextPartInput,
} from "@opencode-ai/sdk/v2/client";

import { captureAnalyticsEvent, markTaskRunStart } from "@/app/lib/analytics";
import { trackSessionActive, trackTaskStarted } from "@/app/lib/den-telemetry";
import { buildDiagnosticsBundleJson } from "@/app/lib/diagnostics-bundle";
import { downloadTextAsFile } from "@/app/lib/download";
import { canCreateWorkspaces } from "@/app/lib/workspace-creation-policy";
import { createClient, unwrap } from "@/app/lib/opencode";
import { abortSessionSafe, compactSession, forkSession, listCommands, revertSession, setSessionArchived, shellInSession, unrevertSession } from "@/app/lib/opencode-session";
import { useSessionManagementStore as sessionManagementStore } from "@/react-app/domains/session/sidebar/session-management-store";
import {
  buildOpenworkWorkspaceBaseUrl,
  readOpenworkServerSettings,
} from "@/app/lib/openwork-server";
import {
  workspaceServerId,
  type ResolvedWorkspaceEndpoint,
} from "@/app/lib/workspace-endpoint";
import { buildOpenworkEnvRuntimeKey } from "@/app/lib/openwork-env-runtime";
import type {
  RoleplayBlock,
  RoleplaySessionSettings,
  RoleplayTurnRecord,
} from "@openwork/types/roleplay";
import { buildRoleplayTurn, type RoleplayTurn } from "@/app/roleplay/turn";
import type { RoleplayTurnDiagnostics } from "@/react-app/domains/roleplay/components/session-settings-panel";
import {
  applySwipeResult,
  createTurnId,
  planSwipe,
  repairAfterFailedSwipe,
  selectAlternative,
} from "@/app/roleplay/swipe";
import { compileBlocks } from "@/app/roleplay/blocks";
import { lorebooksForCharacter, MAX_SCAN_DEPTH, toScanMessages } from "@/app/roleplay/lorebook";
import {
  buildGreetingRequest,
  parseGeneratedGreeting,
  sessionGreeting,
  type RoleplayOpening,
} from "@/app/roleplay/greeting";
import { decideCompaction, MIN_TURNS_BEFORE_COMPACT } from "@/app/roleplay/compact-policy";
import type { GenerationRequest } from "@/app/roleplay/generation/prompts";
import { createMemory, createMemoryId } from "@/app/roleplay/memory";
import {
  buildMemoryExtractRequest,
  buildTranscriptText,
  parseMemoryProposals,
  type MemoryProposal,
} from "@/app/roleplay/memory-extract";
import {
  applyRevision,
  buildRevisionRequest,
  createRevisionId,
  parseRevisionProposals,
  type FieldProposal,
  type RevisableField,
} from "@/app/roleplay/revise";
import type { RoleplaySurfaceState } from "@/app/roleplay/surface-state";
import {
  useApplyRoleplayRevision,
  useBindRoleplaySession,
  useRoleplayLorebooks,
  useRoleplayMemories,
  useRoleplayPersonas,
  useRoleplaySessionBinding,
  useRoleplayTurns,
  useSaveRoleplayMemory,
  useSaveRoleplayTurn,
} from "@/react-app/domains/roleplay/state/roleplay-queries";
import { CardDiff } from "@/react-app/domains/roleplay/components/card-diff";
import { MemoryReview } from "@/react-app/domains/roleplay/components/memory-review";
import { RoleplayPage } from "@/react-app/domains/roleplay/pages/roleplay-page";
import {
  getDesktopHomeDir,
  joinDesktopPath,
  revealDesktopItemInDir,
  pickDirectory,
  resolveWorkspaceListSelectedId,
  workspaceBootstrap,
  workspaceCreateRemote,
  workspaceForget,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  type OpenworkServerInfo,
  type WorkspaceInfo,
  type WorkspaceList,
} from "@/app/lib/desktop";
import type {
  ComposerAttachment,
  ComposerDraft,
  ComposerPart,
  ModelOption,
  ModelRef,
  SlashCommandOption,
  WorkspacePreset,
  WorkspaceConnectionState,
  Client,
  ProviderListItem,
  WorkspaceDisplay,
  WorkspaceSessionGroup,
} from "@/app/types";
import { buildFeedbackUrl } from "@/app/lib/feedback";
import {
  getWorkspaceTaskLoadErrorDisplay,
  isDesktopRuntime,
  isSandboxWorkspace,
  normalizeDirectoryPath,
  normalizeSessionStatus,
  resolveModelDisplayName,
  safeStringify,
} from "@/app/utils";
import { t } from "@/i18n";
import {
  type RouteWorkspace,
  type RouteSession,
  describeRouteError,
  describeWorkspaceCreateError,
  downloadWorkspaceJson,
  folderNameFromPath,
  getSessionStatus,
  isActiveSessionStatus,
  isTransientStartupError,
  mapDesktopWorkspace,
  mergeRouteWorkspaces,
  orderRouteWorkspaces,
  toSessionGroups,
  workspaceExportFilename,
  workspaceLabel,
} from "@/react-app/shell/route-workspaces";
import { useLocal } from "@/react-app/kernel/local-provider";
import { usePlatform } from "@/react-app/kernel/platform";
import { SessionPage, type OpenSessionTab } from "@/react-app/domains/session/chat/session-page";
import { AutomationsPage } from "@/react-app/domains/automations/automations-page";
import { automationsStateChangedEvent } from "@/react-app/domains/automations/automation-events";
import type { NewTaskComposerContext } from "@/react-app/domains/session/chat/new-task-composer";
import { isDesktopProviderBlocked } from "@/app/cloud/desktop-app-restrictions";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { useRestrictionNotice } from "@/react-app/domains/cloud/restriction-notice-provider";
import { ReactSessionRuntime } from "@/react-app/domains/session/sync/runtime-sync";
import { useSessionActivityStore } from "@/react-app/domains/session/status/session-activity-store";
import { buildOpenworkEnvSystemContext } from "@/react-app/domains/session/sync/env-context";
import {
  applySessionRevert,
  applySessionUnrevert,
} from "@/react-app/domains/session/sync/session-sync";
import { firstLineLocalFileParts, joinWorkspaceRelativePath, toFileUrl } from "@/react-app/domains/session/sync/prompt-file-parts";
import { composerAttachmentsToWorkspaceFileParts } from "@/react-app/domains/session/sync/attachment-file-part";
import { useSessionInteractions } from "@/react-app/domains/session/sync/use-session-interactions";
import { useModelBehavior } from "@/react-app/domains/session/surface/use-model-behavior";
import { useSessionFindStore } from "@/react-app/domains/session/surface/find-store";
import { useModelPicker } from "@/react-app/domains/session/modals/use-model-picker";
import { getSessionModelSelection, useSessionModelStore } from "@/react-app/domains/session/surface/session-model-store";
import { openModelPickerEvent, openProviderAuthEvent } from "@/react-app/shell/new-providers-listener";
import { appMentionInstruction } from "@/react-app/domains/session/surface/composer/app-mentions";
import { decodeComposerMentionValue } from "@/react-app/domains/session/surface/composer/mention-encoding";
import { connectSkillPrompt, parseConnectSkillToken } from "@/react-app/domains/session/surface/composer/connect-skill-token";
import { markComposerAutoSend } from "@/react-app/domains/session/surface/composer-auto-send";
import { sendWithRevertRollback } from "@/react-app/domains/session/surface/safe-edit-resend";
import { CreateRemoteWorkspaceModal } from "@/react-app/domains/workspace/create-remote-workspace-modal";
import { CreateWorkspaceModal } from "@/react-app/domains/workspace/create-workspace-modal";
import type { CreateWorkspaceOptions } from "@/react-app/domains/workspace/types";
import { isCloudManagedProviderKey } from "@/react-app/domains/connections/provider-auth/cloud-provider-config";
import { assignedModelOptions } from "@/react-app/domains/connections/provider-auth/assigned-model-options";
import {
  filterEntitledModelOptions,
  resolveEntitledOrgDefaultModel,
  type ModelEntitlementOption,
} from "@/react-app/domains/connections/provider-auth/provider-policy";
import {
  isManagedModelAvailabilityPending,
  isOrganizationModelsEmpty,
  shouldAutoOpenUnavailableModelPicker,
} from "@/react-app/domains/connections/provider-auth/managed-models-recovery";
import { useSessionProviderAuth } from "@/react-app/domains/connections/provider-auth/use-session-provider-auth";
import {
  disabledProvidersFromConfig,
  updateManagedDisabledProviders,
} from "@/react-app/domains/connections/managed-engine-config";
import { useMcpConnectedCount } from "@/react-app/domains/connections/use-mcp-connected-count";
import { useSessionMcpMaintenance } from "@/react-app/domains/connections/use-session-mcp-maintenance";
import { useCloudMcpSubmitReadiness } from "@/react-app/domains/connections/use-cloud-mcp-submit-readiness";
import type { CloudMcpSubmissionResult } from "@/react-app/domains/connections/cloud-mcp-submit-readiness";
import { useRemoteAccessRestart } from "@/react-app/domains/workspace/remote-access-restart";
import { RenameWorkspaceModal } from "@/react-app/domains/workspace/rename-workspace-modal";
import { useRemoteWorkspaceConnectionEditor } from "@/react-app/domains/workspace/use-remote-workspace-connection-editor";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import {
  hasOpenWorkModelsAvailable,
  shouldShowOpenWorkModelsSyncing,
} from "@/react-app/domains/cloud/openwork-models-promo";
import {
  diagnoseRemoteWorkspaceTaskLoadFailure,
  getRemoteWorkspaceConnectionKey,
  testRemoteWorkspaceConnection,
} from "@/react-app/domains/workspace/remote-workspace-diagnostics";
import { useShareWorkspaceState } from "@/react-app/domains/workspace/share-workspace-state";
import { ModelPickerModal, MODEL_PICKER_UNAVAILABLE_SUBTITLE } from "@/react-app/domains/session/modals/model-picker-modal";
import { CommandPalette, type PaletteItem, type SessionGroupOption } from "./command-palette";
import { buildCommandPaletteSessions } from "./command-palette-sessions";
import { SessionSearchDialog } from "./session-search-dialog";
import type { SessionMessageFetcher } from "@/react-app/domains/session/search/session-search";
import { useBootState } from "./boot-state";
import {
  forgetWorkspaceMemory,
  readLastSessionFor,
  readWorkspaceProjectDimension,
  readWorkspaceOrderIds,
  writeActiveWorkspaceId,
  writeLastSessionFor,
  writeWorkspaceProjectDimension,
  writeWorkspaceOrderIds,
} from "./session-memory";
import {
  publishInspectorSlice,
  recordInspectorEvent,
} from "../../app/lib/app-inspector";
import { saveSessionDraft } from "@/react-app/domains/session/sync/draft-store";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { useControlAction, type OpenworkControlAction } from "./control/control-provider";
import { useReactRenderWatchdog } from "./react-render-watchdog";
import { useBootOverlayVisible } from "./boot-state";

import {
  createDenClient,
  isDenOrgAdminRole,
  readDenSettings,
  type DenOrgRole,
} from "@/app/lib/den";
import { denSessionUpdatedEvent, denSettingsChangedEvent } from "@/app/lib/den-session-events";

import { filterProviderList } from "@/app/utils/providers";
import { ensureDesktopLocalOpenworkConnection } from "./desktop-local-openwork";
import { resolveOpenworkConnection } from "./openwork-connection";
import { useReloadCoordinator } from "./reload-coordinator";
import { useShellConfig } from "./shell-config";
import { useShellShortcuts } from "./use-shell-shortcuts";
import { useEngineReload } from "./use-engine-reload";
import { useSessionGroupSync } from "./use-session-group-sync";
import { useWorkspaceRouteState } from "./use-workspace-route-state";
import { CloudWorkspaceBootTakeover, useCloudWorkspaceStatus } from "./cloud-workspace-overlay";
import {
  cloudWorkspaceStatusHasReadyContent,
  mapCloudWorkspaceMainContentDecision,
  shouldRefetchCloudWorkspaceOnReadyTransition,
} from "./cloud-workspace-status";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { useSessionControlActions } from "@/react-app/domains/session/control/session-control-actions";
import {
  globalExtensionsRoute,
  legacySessionRoute,
  automationsRoute,
  workspaceExtensionsRoute,
  workspaceSessionRoute,
  workspaceSettingsRoute,
} from "./workspace-routes";
import { WorkspaceProvider } from "./workspace-provider";
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { SettingsSurface } from "./settings-route";
import { writeStoredDefaultModel } from "@/react-app/kernel/model-config";
import {
  ensureProviderListQuery,
  getConnectedProviderItems,
  isModelAvailableInConnectedProviders,
  refreshProviderListQueries,
  useProviderListQuery,
} from "@/react-app/infra/provider-list-query";

/**
 * Serialize an SDK error value into a string that parseSessionError can parse.
 * Preserves the original shape (name, data, message) as JSON when possible,
 * so the session surface can detect ProviderModelNotFoundError and offer
 * recovery actions like "Change model".
 */
function serializeSDKError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      const msg = (error as Record<string, unknown>).message;
      return typeof msg === "string" ? msg : String(error);
    }
  }
  return String(error);
}

function describeTaskCreateError(error: unknown) {
  const message = describeRouteError(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("connection") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("connection lost") ||
    lower.includes("internal_error") ||
    lower.includes("unexpected server error")
  ) {
    return "OpenCode is unavailable for this workspace. Retry once it restarts, or restart OpenWork if the problem continues.";
  }
  return message;
}

function providerListModelEntitlementOptions(
  providerList: ProviderListResponse | null | undefined,
): ModelEntitlementOption[] {
  return getConnectedProviderItems(providerList).flatMap((provider) =>
    Object.keys(provider.models ?? {}).map((modelID) => ({
      providerID: provider.id,
      modelID,
    })),
  );
}

function taskCreateUnavailableToastId(workspaceId: string) {
  return `opencode-unavailable:${workspaceId}`;
}

function focusPromptSoon() {
  if (typeof window === "undefined") return;
  const focus = () => window.dispatchEvent(new Event("openwork:focusPrompt"));
  [0, 80, 240, 600].forEach((delay) => window.setTimeout(focus, delay));
}

const EVAL_UNAVAILABLE_PROVIDER_ID = "eval-unavailable-provider";

function nextEvalUnavailableModel(current: ModelRef | null | undefined) {
  return {
    providerID: EVAL_UNAVAILABLE_PROVIDER_ID,
    modelID: current?.providerID === EVAL_UNAVAILABLE_PROVIDER_ID && current.modelID === "eval-unavailable-model-a"
      ? "eval-unavailable-model-b"
      : "eval-unavailable-model-a",
  } satisfies ModelRef;
}

// All workspace-scoped server URLs/clients/tokens come from
// `resolveWorkspaceEndpoint` in apps/app/src/app/lib/workspace-endpoint.ts.
// Don't compose `<baseUrl>/workspace/<id>` here.

/**
 * Record the turn the user just sent, so it can be regenerated later.
 *
 * `promptAsync` answers 204 with no body, and inventing a message id
 * client-side would collide with the engine's own ordering scheme, so the ids
 * are read back from the session. The record is keyed by a client-generated
 * `turnId`, not by the message id: a regenerate mints new ids for both the user
 * message and the reply, so a message-keyed record would be orphaned by the one
 * operation it exists to survive.
 *
 * Failures are logged rather than thrown: losing the ability to replay a swipe
 * is not a reason to fail a turn the user already sent.
 */
async function persistRoleplayTurn(input: {
  endpoint: ResolvedWorkspaceEndpoint | null;
  listMessages: (sessionId: string) => Promise<Array<{ info: { id: string; role: string } }> | undefined>;
  sessionId: string;
  turnId: string;
  userText: string;
  blocks: RoleplayBlock[];
}) {
  if (!input.endpoint) return;
  try {
    const messages = (await input.listMessages(input.sessionId)) ?? [];
    const latestUser = [...messages].reverse().find((entry) => entry.info.role === "user");
    if (!latestUser) return;
    await input.endpoint.client.putRoleplayTurn(input.endpoint.workspaceId, {
      turnId: input.turnId,
      sessionId: input.sessionId,
      messageId: latestUser.info.id,
      userText: input.userText,
      blocks: input.blocks,
      alternatives: [],
      activeAlternative: 0,
      createdAt: Date.now(),
    });
  } catch (error) {
    console.warn("[roleplay] could not persist the turn", error);
  }
}

/** Total characters of rendered text in a session, for the compaction estimate. */
async function transcriptTextLength(
  client: { session: { messages: (parameters: { sessionID: string }) => Promise<{ data?: Array<{ parts?: Array<{ type: string; text?: string }> }> }> } },
  sessionId: string,
): Promise<number> {
  try {
    const messages = (await client.session.messages({ sessionID: sessionId })).data ?? [];
    return messages.reduce(
      (total, message) =>
        total + (message.parts ?? []).reduce((sum, part) => sum + (part.type === "text" ? (part.text ?? "").length : 0), 0),
      0,
    );
  } catch {
    // An unreadable transcript is not a reason to refuse the send; skipping
    // compaction costs a longer prompt, refusing costs the user their turn.
    return 0;
  }
}

async function draftToParts(
  draft: ComposerDraft,
  workspaceRoot: string,
  sessionId: string,
  endpoint: ResolvedWorkspaceEndpoint | null,
) {
  const parts: Array<TextPartInput | FilePartInput | AgentPartInput> = [];
  const root = workspaceRoot.trim();

  const toAbsolutePath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("/")) return trimmed;
    if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return trimmed;
    if (!root) return "";
    return joinWorkspaceRelativePath(root, trimmed);
  };

  const filenameFromPath = (path: string) => {
    const normalized = path.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "file";
  };

  const attachmentFileById = new Map<string, FilePartInput>();
  if (draft.attachments.length > 0) {
    if (!endpoint) {
      throw new Error("Workspace endpoint is unavailable; attachments could not be copied for tool access.");
    }
    const uploaded = await composerAttachmentsToWorkspaceFileParts({
      attachments: draft.attachments,
      endpoint,
      sessionId,
      workspaceRoot: root,
    });
    for (const part of uploaded) {
      if (part.type === "text") {
        parts.push(part);
        continue;
      }
    }
    const fileParts = uploaded.filter((part): part is FilePartInput => part.type === "file");
    for (const [index, attachment] of draft.attachments.entries()) {
      const filePart = fileParts[index];
      if (filePart) attachmentFileById.set(attachment.id, filePart);
    }
  }

  // Prefer draft.text token order so attachment chips stay inline with surrounding text
  // (same positions as the composer), instead of dumping every file part at the end.
  const hasAttachmentTokens = /\[attachment [^\]]+\]/.test(draft.text);
  if (hasAttachmentTokens || attachmentFileById.size > 0) {
    const pasteByLabel = new Map(
      draft.parts
        .filter((part): part is Extract<ComposerPart, { type: "paste" }> => part.type === "paste")
        .map((part) => [part.label, part.text] as const),
    );
    for (const segment of draft.text.split(/(\[attachment [^\]]+\]|\[pasted text [^\]]+\]|\[connect-skill [^\]]+\]|\[skill [^\]]+\]|@[^\s@]+)/)) {
      if (!segment) continue;
      const attachmentMatch = segment.match(/^\[attachment (.+)\]$/);
      if (attachmentMatch?.[1]) {
        const filePart = attachmentFileById.get(attachmentMatch[1]);
        if (filePart) {
          parts.push(filePart);
          attachmentFileById.delete(attachmentMatch[1]);
        }
        continue;
      }
      const pasteMatch = segment.match(/^\[pasted text (.+)\]$/);
      if (pasteMatch?.[1]) {
        const pasted = pasteByLabel.get(pasteMatch[1]);
        if (pasted) parts.push({ type: "text", text: pasted });
        continue;
      }
      const connectSkill = parseConnectSkillToken(segment);
      if (connectSkill) {
        parts.push({ type: "text", text: connectSkillPrompt(connectSkill) });
        continue;
      }
      const skillMatch = segment.match(/^\[skill (.+)\]$/);
      if (skillMatch?.[1]) {
        parts.push({ type: "text", text: `Load [skill ${skillMatch[1]}] and follow its instructions.` });
        continue;
      }
      if (segment.startsWith("@")) {
        const value = decodeComposerMentionValue(segment.slice(1));
        const mentionPart = draft.parts.find((part) =>
          (part.type === "agent" && part.name === value)
          || (part.type === "app" && part.name === value)
          || (part.type === "file" && part.path === value),
        );
        if (mentionPart?.type === "agent") {
          parts.push({ type: "agent", name: mentionPart.name });
          continue;
        }
        if (mentionPart?.type === "app") {
          parts.push({ type: "text", text: appMentionInstruction(mentionPart.name) });
          continue;
        }
        if (mentionPart?.type === "file") {
          const absolute = toAbsolutePath(mentionPart.path);
          if (!absolute) continue;
          parts.push({
            type: "file",
            mime: "text/plain",
            url: toFileUrl(absolute),
            filename: filenameFromPath(mentionPart.path),
          });
          continue;
        }
      }
      parts.push({ type: "text", text: segment });
    }
    for (const filePart of attachmentFileById.values()) {
      parts.push(filePart);
    }
  } else {
    for (const part of draft.parts) {
      if (part.type === "text") {
        parts.push({ type: "text", text: part.text });
        continue;
      }
      if (part.type === "paste") {
        parts.push({ type: "text", text: part.text });
        continue;
      }
      if (part.type === "agent") {
        parts.push({ type: "agent", name: part.name });
        continue;
      }
      if (part.type === "skill") {
        parts.push({ type: "text", text: `Load [skill ${part.name}] and follow its instructions.` });
        continue;
      }
      if (part.type === "app") {
        parts.push({ type: "text", text: appMentionInstruction(part.name) });
        continue;
      }
      if (part.type === "file") {
        const absolute = toAbsolutePath(part.path);
        if (!absolute) continue;
        parts.push({
          type: "file",
          mime: "text/plain",
          url: toFileUrl(absolute),
          filename: filenameFromPath(part.path),
        });
      }
    }
  }

  parts.push(...firstLineLocalFileParts(draft.resolvedText ?? draft.text, root));

  return parts;
}

/** What the settings panel reports about a send, taken from the turn that was actually built. */
function turnDiagnostics(turn: RoleplayTurn): RoleplayTurnDiagnostics {
  return { lorebook: turn.lorebook, systemChars: turn.composed.chars, truncated: turn.composed.truncated };
}

function singlePickedDirectory(selection: string | string[] | null) {
  return typeof selection === "string"
    ? selection
    : Array.isArray(selection)
      ? selection[0] ?? null
      : null;
}

export function SessionRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const automationsRouteRequested = /^\/automations(?:\/|$)/.test(location.pathname);
  // The character library mounts here rather than as its own route so it reuses
  // the workspace endpoint this route already resolved. Composing that URL by
  // hand is the bug class `workspace-endpoint.ts` exists to prevent.
  const roleplayRouteActive = /^\/roleplay(?:\/|$)/.test(location.pathname);
  const platform = usePlatform();
  const denAuth = useDenAuth();
  const { config: shellConfig } = useShellConfig();
  const local = useLocal();
  const automationsEnabled = isDesktopRuntime();
  const automationsRouteActive = automationsEnabled && automationsRouteRequested;
  const denSettings = readDenSettings();
  const [automationsSupported, setAutomationsSupported] = useState(false);
  const [automationsNeedAttention, setAutomationsNeedAttention] = useState(false);
  useEffect(() => {
    if (!automationsRouteRequested || automationsEnabled) return;
    navigate("/", { replace: true });
  }, [automationsEnabled, automationsRouteRequested, navigate]);
  useEffect(() => {
    const authToken = denSettings.authToken?.trim();
    const organizationId = denSettings.activeOrgId?.trim();
    if (!automationsEnabled || !denAuth.isSignedIn || !authToken || !organizationId) {
      setAutomationsSupported(false);
      setAutomationsNeedAttention(false);
      return;
    }
    let cancelled = false;
    const client = createDenClient({ baseUrl: denSettings.baseUrl, token: authToken });
    const refreshAutomationState = () => {
      void client.listAutomations(organizationId, { limit: 100 })
        .then((result) => {
          if (cancelled) return;
          setAutomationsSupported(true);
          setAutomationsNeedAttention(result.items.some((item) => item.automation.state === "needs_attention"));
        })
        .catch(() => {
          if (cancelled) return;
          setAutomationsSupported(false);
          setAutomationsNeedAttention(false);
        });
    };
    refreshAutomationState();
    const interval = window.setInterval(refreshAutomationState, 15_000);
    window.addEventListener(automationsStateChangedEvent, refreshAutomationState);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener(automationsStateChangedEvent, refreshAutomationState);
    };
  }, [
    automationsEnabled,
    denAuth.isSignedIn,
    denAuth.status,
    denSettings.activeOrgId,
    denSettings.authToken,
    denSettings.baseUrl,
  ]);
  const automationsNavigationAvailable = automationsEnabled && automationsSupported;
  const reloadCoordinator = useReloadCoordinator();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const restrictionNotice = useRestrictionNotice();
  const [activeOrganizationRole, setActiveOrganizationRole] = useState<DenOrgRole | null>(null);
  const [openworkServerHostInfoState, setOpenworkServerHostInfoState] = useState<OpenworkServerInfo | null>(null);
  const [openworkServerSettingsVersion, setOpenworkServerSettingsVersion] = useState(0);

  const [developerMode, setDeveloperMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("openwork.developerMode") === "1";
  });
  const {
    navigateToWorkspaceSession,
    routeWorkspaceId,
    selectedSessionId,
    loading,
    effectiveLoading,
    client,
    baseUrl,
    token,
    workspaces,
    setWorkspaces,
    workspacesRef,
    workspaceOrderIds,
    setWorkspaceOrderIds,
    workspaceOrderIdsRef,
    sessionsByWorkspaceId,
    setSessionsByWorkspaceId,
    sessionsByWorkspaceIdRef,
    errorsByWorkspaceId,
    setErrorsByWorkspaceId,
    workspaceConnectionOverrides,
    routeError,
    setRouteError,
    legacySelectedWorkspaceId,
    setLegacySelectedWorkspaceId,
    retryingWorkspaceIds,
    setRetryingWorkspaceIds,
    startupRetryTimerRef,
    selectedWorkspaceId,
    selectedWorkspace,
    selectedWorkspaceRoot,
    selectedWorkspaceEndpoint,
    selectedWorkspaceServerToken,
    opencodeBaseUrl,
    opencodeClient,
    selectedWorkspaceIsLoading,
    selectedWorkspaceError,
    routeNotFoundMessage,
    endpointForWorkspace,
    refreshRouteState,
    loadWorkspaceSessionsInBackground,
    rememberPendingCreatedSession,
    handleRuntimeSessionCreated,
    handleRuntimeSessionUpdated,
    handleRuntimeSessionDeleted,
    handleRemoteWorkspaceConnectionSaved,
    runRemoteWorkspaceConnectionCheck,
  } = useWorkspaceRouteState({
    developerMode,
    workspaceRoute: automationsRouteActive ? "automations" : roleplayRouteActive ? "roleplay" : "session",
    onServerSettingsChanged: () => setOpenworkServerSettingsVersion((value) => value + 1),
    onHostInfo: setOpenworkServerHostInfoState,
  });
  const cloudWorkspace = useCloudWorkspaceStatus();
  const bootOverlayVisible = useBootOverlayVisible();
  const previousCloudWorkspaceStatusRef = useRef<typeof cloudWorkspace.viewModel.variant | null>(null);
  useEffect(() => {
    const previousStatus = previousCloudWorkspaceStatusRef.current;
    previousCloudWorkspaceStatusRef.current = cloudWorkspace.viewModel.variant;
    if (!shouldRefetchCloudWorkspaceOnReadyTransition({
      previousStatus,
      nextStatus: cloudWorkspace.viewModel.variant,
      gatewayMode: cloudWorkspace.gatewayMode && cloudWorkspace.visible,
    })) return;
    void refreshRouteState({ supersede: true });
  }, [cloudWorkspace.gatewayMode, cloudWorkspace.viewModel.variant, cloudWorkspace.visible, refreshRouteState]);
  const cloudMcpProviderModel = useMemo(() => local.prefs.defaultModel
    ? {
        provider: local.prefs.defaultModel.providerID,
        model: local.prefs.defaultModel.modelID,
      }
    : undefined, [local.prefs.defaultModel?.modelID, local.prefs.defaultModel?.providerID]);
  const sessionMcpMaintenance = useSessionMcpMaintenance({
    cloudSignedIn: denAuth.isSignedIn,
    client: selectedWorkspaceEndpoint?.client ?? null,
    workspaceId: selectedWorkspaceEndpoint?.workspaceId ?? null,
    opencodeClient,
    directory: selectedWorkspaceRoot,
    engineReloadBusy: reloadCoordinator.reloadBusy,
    providerModel: cloudMcpProviderModel,
  });
  const {
    state: cloudMcpSubmissionState,
    submit: submitWithCloudMcpReadiness,
    clearFailure: clearCloudMcpSubmissionFailure,
  } = useCloudMcpSubmitReadiness({
    cloudAuthStatus: denAuth.status,
    client: selectedWorkspaceEndpoint?.client ?? null,
    workspaceId: selectedWorkspaceEndpoint?.workspaceId ?? null,
    providerModel: cloudMcpProviderModel,
  });
  const roleplayBindingQuery = useRoleplaySessionBinding(selectedWorkspaceEndpoint, selectedSessionId);
  const roleplayPersonasQuery = useRoleplayPersonas(selectedWorkspaceEndpoint);
  const bindRoleplaySession = useBindRoleplaySession(selectedWorkspaceEndpoint);
  const roleplayMemoriesQuery = useRoleplayMemories(
    selectedWorkspaceEndpoint,
    roleplayBindingQuery.data?.binding?.characterId ?? null,
  );
  const roleplayLorebooksQuery = useRoleplayLorebooks(selectedWorkspaceEndpoint);
  /**
   * The session whose opening line is still being written.
   *
   * Kept in memory rather than on the binding: a flag on disk outlives the app,
   * so a crash mid-generation would leave a conversation permanently blocked
   * with no way to clear it. Losing this on reload costs nothing — the card's
   * greeting comes back and the user can chat.
   */
  const [greetingPendingSessionId, setGreetingPendingSessionId] = useState<string | null>(null);
  /**
   * What the last send put in the prompt, for the settings panel to report.
   *
   * In memory and scoped to one session: it describes a turn that has already
   * happened, so persisting it would outlive the settings that produced it and
   * describe a prompt the next send will not build.
   */
  const [roleplayDiagnostics, setRoleplayDiagnostics] = useState<
    { sessionId: string; diagnostics: RoleplayTurnDiagnostics } | null
  >(null);
  const roleplaySurface = useMemo<RoleplaySurfaceState | null>(() => {
    const binding = roleplayBindingQuery.data?.binding;
    const character = roleplayBindingQuery.data?.character;
    if (!binding || !character) return null;
    const personas = roleplayPersonasQuery.data ?? [];
    const persona = personas.find((entry) => entry.id === binding.personaId) ?? personas[0];
    return {
      characterName: character.card.data.name,
      card: character.card,
      persona: persona?.persona ?? { name: "", description: "" },
      greeting: sessionGreeting(binding.greeting, character.card),
      storySoFar: binding.storySoFar,
      memories: roleplayMemoriesQuery.data ?? [],
      greetingPending: greetingPendingSessionId === binding.sessionId,
      lorebooks: lorebooksForCharacter(roleplayLorebooksQuery.data ?? [], binding.characterId),
      settings: binding.settings,
      characterId: binding.characterId,
    };
  }, [
    greetingPendingSessionId,
    roleplayBindingQuery.data,
    roleplayLorebooksQuery.data,
    roleplayMemoriesQuery.data,
    roleplayPersonasQuery.data,
  ]);
  const roleplayTurnsQuery = useRoleplayTurns(selectedWorkspaceEndpoint, roleplaySurface ? selectedSessionId : null);
  const saveRoleplayTurn = useSaveRoleplayTurn(selectedWorkspaceEndpoint);
  const saveRoleplayMemory = useSaveRoleplayMemory(selectedWorkspaceEndpoint);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([]);
  const [memoryReviewOpen, setMemoryReviewOpen] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const applyRoleplayRevision = useApplyRoleplayRevision(selectedWorkspaceEndpoint);
  const [revisionProposals, setRevisionProposals] = useState<FieldProposal[]>([]);
  const [revisionReviewOpen, setRevisionReviewOpen] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [roleplayBusy, setRoleplayBusy] = useState(false);
  const [roleplayCompacted, setRoleplayCompacted] = useState(false);
  // Compaction and the abort/revert/prompt chain are independent calls against
  // the same session with nothing serialising them, so a compaction that fired
  // during a regenerate would race the revert. This latch is that serialisation.
  // It holds the session id rather than a flag: this component is not remounted
  // per session, so a boolean would also suppress compaction for every other
  // session while one of them is mid-regenerate.
  const revertInFlightRef = useRef<string | null>(null);
  const latestRoleplayTurn = useMemo(() => roleplayTurnsQuery.data?.at(-1) ?? null, [roleplayTurnsQuery.data]);
  // Agent selection is persisted in local prefs (like the model variant) so
  // it survives reloads instead of silently falling back to "build" (#2101).
  const selectedAgent = local.prefs.selectedAgent;
  const setSelectedAgent = useCallback(
    (agent: string | null) => {
      local.setPrefs((previous) => ({ ...previous, selectedAgent: agent }));
    },
    [local.setPrefs],
  );
  // One-way latch for "a refreshRouteState is currently running"; prevents
  // overlapping route refreshes from queueing up when the user clicks fast.
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const [createWorkspaceRemoteBusy, setCreateWorkspaceRemoteBusy] = useState(false);
  const [createWorkspaceRemoteError, setCreateWorkspaceRemoteError] = useState<string | null>(null);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(null);
  const [renameWorkspaceTitle, setRenameWorkspaceTitle] = useState("");
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false);
  const [paletteAccessibleTargets, setPaletteAccessibleTargets] = useState<OpenTarget[]>([]);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, string>>({});
  const [providerConnectedIds, setProviderConnectedIds] = useState<string[]>([]);
  const [disabledProviderIds, setDisabledProviderIds] = useState<string[]>([]);
  // Bump to re-filter provider list when den session changes (sign-in/out)
  const [denSessionVersion, setDenSessionVersion] = useState(0);
  useEffect(() => {
    const handler = () => setDenSessionVersion((v) => v + 1);
    window.addEventListener(denSessionUpdatedEvent, handler);
    window.addEventListener(denSettingsChangedEvent, handler);
    return () => {
      window.removeEventListener(denSessionUpdatedEvent, handler);
      window.removeEventListener(denSettingsChangedEvent, handler);
    };
  }, []);

  // Provider IDs that were just added — used to highlight them as
  useEffect(() => {
    setPaletteAccessibleTargets([]);
  }, [selectedSessionId, selectedWorkspaceId]);

  // Provider catalog cache. Used to compute the reasoning/thinking variant
  // options for whichever model is currently selected so the composer's
  // behavior pill actually shows its options (bug: was empty before).

  const openworkServerSettings = useMemo(
    () => readOpenworkServerSettings(),
    [openworkServerSettingsVersion],
  );

  const activeReloadBlockingSessions = useMemo(
    () =>
      Object.values(sessionsByWorkspaceId)
        .flat()
        .flatMap((session) => {
          if (!isActiveSessionStatus(getSessionStatus(session))) return [];
          const id = String(session?.id ?? "");
          if (!id) return [];
          return [{
            id,
            title:
              String(session?.title ?? session?.slug ?? session?.id ?? "").trim() ||
              t("session.untitled"),
          }];
        }),
    [sessionsByWorkspaceId],
  );
  const activeSelectedWorkspaceSessionIds = useMemo(
    () =>
      (sessionsByWorkspaceId[selectedWorkspaceId] ?? []).flatMap((session) => {
        if (!isActiveSessionStatus(getSessionStatus(session))) return [];
        const id = String(session?.id ?? "").trim();
        return id ? [id] : [];
      }),
    [selectedWorkspaceId, sessionsByWorkspaceId],
  );
  const remoteAccessRestart = useRemoteAccessRestart({
    isEnabled: () => openworkServerSettings.remoteAccessEnabled === true,
    onHostInfo: setOpenworkServerHostInfoState,
    onSettingsChanged: () => setOpenworkServerSettingsVersion((value) => value + 1),
  });

  const { engineReloadVersion, routeEngineInfo, reloadWorkspaceEngineFromUi } = useEngineReload({
    client,
    workspaceId: selectedWorkspaceId,
    workspace: selectedWorkspace,
    endpointForWorkspace,
    activeReloadBlockingSessions,
    onError: setRouteError,
    refreshRouteState,
  });

  const environmentRuntimeKey = useMemo(
    () => buildOpenworkEnvRuntimeKey({
      baseUrl: client?.baseUrl ?? null,
      pid: openworkServerHostInfoState?.pid ?? null,
      port: openworkServerHostInfoState?.port ?? null,
    }),
    [client?.baseUrl, openworkServerHostInfoState?.pid, openworkServerHostInfoState?.port],
  );

  const handleApplyEnvironmentChanges = useCallback(async () => {
    if (!isDesktopRuntime()) {
      throw new Error(t("settings.environment.apply_unavailable"));
    }
    if (activeReloadBlockingSessions.length > 0) {
      throw new Error(t("settings.environment.apply_blocked_active_tasks"));
    }
    if (!selectedWorkspaceRoot) {
      throw new Error(t("settings.environment.apply_no_local_workspace"));
    }
    const reloaded = await reloadWorkspaceEngineFromUi();
    if (!reloaded) {
      throw new Error(t("app.error_connect_first"));
    }
  }, [activeReloadBlockingSessions.length, reloadWorkspaceEngineFromUi, selectedWorkspaceRoot]);

  const shareWorkspaceState = useShareWorkspaceState({
    workspaces,
    openworkServerHostInfo: openworkServerHostInfoState,
    openworkServerSettings,
    engineInfo: routeEngineInfo,
    exportWorkspaceBusy: false,
    openLink: (url) => platform.openLink(url),
    workspaceLabel,
  });


  const remoteWorkspaceConnectionEditor = useRemoteWorkspaceConnectionEditor({
    workspaces,
    client,
    onSaved: handleRemoteWorkspaceConnectionSaved,
  });


  const workspaceSessionGroups = useMemo(
    () => toSessionGroups(workspaces, sessionsByWorkspaceId, errorsByWorkspaceId, new Set(retryingWorkspaceIds)),
    [errorsByWorkspaceId, retryingWorkspaceIds, sessionsByWorkspaceId, workspaces],
  );
  useSessionGroupSync({ workspaces, endpointForWorkspace });
  const selectedWorkspaceGroupState = sessionManagementStore((state) => (
    selectedWorkspaceId ? state.groupsByWorkspace[selectedWorkspaceId] : undefined
  ));
  const assignSessionToGroup = sessionManagementStore((state) => state.assignGroup);
  const seedWorkspaceActivitySessions = useSessionActivityStore((state) => state.seedWorkspaceSessions);
  const sessionActivityByWorkspaceId = useSessionActivityStore((state) => state.statusesByWorkspaceId);

  useEffect(() => {
    for (const group of workspaceSessionGroups) {
      seedWorkspaceActivitySessions(group.workspace.id, group.sessions);
      const serverId = workspaceServerId(group.workspace);
      if (serverId && serverId !== group.workspace.id) {
        seedWorkspaceActivitySessions(serverId, group.sessions);
      }
    }
  }, [seedWorkspaceActivitySessions, workspaceSessionGroups]);

  const sidebarSessionStatusById = useMemo(() => {
    const next: Record<string, string> = {};
    for (const group of workspaceSessionGroups) {
      const serverId = workspaceServerId(group.workspace);
      const workspaceStatuses = {
        ...(sessionActivityByWorkspaceId[group.workspace.id] ?? {}),
        ...(serverId ? sessionActivityByWorkspaceId[serverId] ?? {} : {}),
      };
      for (const session of group.sessions) {
        const status = workspaceStatuses[session.id];
        if (status) next[session.id] = status;
      }
    }
    return next;
  }, [sessionActivityByWorkspaceId, workspaceSessionGroups]);

  const sidebarActiveWorkspaceId = useMemo(() => {
    const sessionId = selectedSessionId?.trim() ?? "";
    if (sessionId) {
      const owner = workspaceSessionGroups.find((group) =>
        group.sessions.some((session) => session?.id === sessionId),
      );
      if (owner?.workspace.id) return owner.workspace.id;
    }
    return selectedWorkspaceId;
  }, [selectedSessionId, selectedWorkspaceId, workspaceSessionGroups]);

  const workspaceConnectionStateById = useMemo(() => {
    const next: Record<string, WorkspaceConnectionState> = { ...workspaceConnectionOverrides };
    for (const workspace of workspaces) {
      if (workspace.workspaceType !== "remote") continue;
      const error = errorsByWorkspaceId[workspace.id]?.trim();
      if (!error || next[workspace.id]?.status === "connecting") continue;
      next[workspace.id] ??= {
        status: "error",
        message: getWorkspaceTaskLoadErrorDisplay(workspace, error).message || error,
        checkedAt: null,
      };
    }
    return next;
  }, [errorsByWorkspaceId, workspaceConnectionOverrides, workspaces]);

  const mcpConnectedCount = useMcpConnectedCount(opencodeClient, selectedWorkspaceRoot);
  const providerListQuery = useProviderListQuery({
    client: opencodeClient,
    baseUrl: opencodeBaseUrl,
    directory: selectedWorkspaceRoot || undefined,
  });
  const { providerCatalog, modelVariantLabel, modelBehaviorOptions, modelVariantValue } =
    useModelBehavior({
      providerList: providerListQuery.data,
      defaultModel: local.prefs.defaultModel,
      modelVariant: local.prefs.modelVariant ?? null,
    });
  const {
    store: sessionProviderAuthStore,
    snapshot: sessionProviderAuthSnapshot,
    cloudProviderSyncReady,
    cloudProviderList,
    refreshCloudProviderSync,
  } = useSessionProviderAuth({
    opencodeClient,
    opencodeBaseUrl,
    providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviderIds,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceRoot,
    selectedWorkspaceId,
    localServerHostToken: openworkServerHostInfoState?.hostToken?.trim() ?? "",
    setProviders,
    setProviderDefaults,
    setProviderConnectedIds,
    setDisabledProviderIds,
  });
  const organizationAssignedModelOptions = useMemo(
    () => assignedModelOptions(sessionProviderAuthSnapshot.cloudOrgProviders),
    [sessionProviderAuthSnapshot.cloudOrgProviders],
  );
  useEffect(() => {
    if (!denAuth.isSignedIn) {
      setActiveOrganizationRole(null);
      return;
    }

    const settings = readDenSettings();
    const tokenValue = settings.authToken?.trim() ?? "";
    const activeOrgId = settings.activeOrgId?.trim() ?? "";
    const activeOrgSlug = settings.activeOrgSlug?.trim() ?? "";
    if (!tokenValue || (!activeOrgId && !activeOrgSlug)) {
      setActiveOrganizationRole(null);
      return;
    }

    let cancelled = false;
    void createDenClient({ baseUrl: settings.baseUrl, token: tokenValue })
      .listOrgs()
      .then((response) => {
        if (cancelled) return;
        const active = response.orgs.find((org) =>
          org.id === activeOrgId || org.slug === activeOrgSlug,
        );
        setActiveOrganizationRole(active?.role ?? null);
      })
      .catch(() => {
        if (!cancelled) setActiveOrganizationRole(null);
      });

    return () => {
      cancelled = true;
    };
  }, [denAuth.isSignedIn, denAuth.status, denSessionVersion]);
  const handleModelPickerOpen = useCallback(() => {
    void refreshCloudProviderSync("model_picker_open");
  }, [refreshCloudProviderSync]);
  const openWorkModelsEntitled = useMemo(() => {
    if (!denAuth.isSignedIn) return false;
    const fromOrg = sessionProviderAuthSnapshot.cloudOrgProviders.some(
      (provider) =>
        [provider.providerId, provider.source].some(
          (value) => value?.trim().toLowerCase() === "openwork",
        ),
    );
    const fromImport = Object.values(sessionProviderAuthSnapshot.importedCloudProviders ?? {}).some(
      (provider) =>
        [provider.providerId, provider.source, provider.sourceProviderId].some(
          (value) => value?.trim().toLowerCase() === "openwork",
        ),
    );
    return fromOrg || fromImport;
  }, [
    denAuth.isSignedIn,
    sessionProviderAuthSnapshot.cloudOrgProviders,
    sessionProviderAuthSnapshot.importedCloudProviders,
  ]);
  const refreshOrganizationModelAccess = useCallback(async () => {
    await refreshCloudProviderSync("manual");
  }, [refreshCloudProviderSync]);
  useEffect(() => {
    if (!cloudProviderSyncReady || !cloudProviderList) return;
    clearCloudMcpSubmissionFailure();
  }, [clearCloudMcpSubmissionFailure, cloudProviderList, cloudProviderSyncReady]);
  const organizationModelsSettingsUrl = useMemo(() => {
    if (!isDenOrgAdminRole(activeOrganizationRole)) {
      return undefined;
    }
    return new URL("/dashboard/custom-llm-providers", readDenSettings().baseUrl).toString();
  }, [activeOrganizationRole, denSessionVersion]);
  const restrictToCloudProviders = checkDesktopRestriction({ restriction: "allowCustomProviders" });
  const entitledModelOptions = useMemo(() => {
    const runtimeOptions = providerListModelEntitlementOptions(
      cloudProviderList ?? providerListQuery.data,
    );
    return filterEntitledModelOptions(
      runtimeOptions.length > 0 ? runtimeOptions : organizationAssignedModelOptions,
      {
        restrictToCloud: restrictToCloudProviders,
        checkRestriction: checkDesktopRestriction,
      },
    );
  }, [
    checkDesktopRestriction,
    cloudProviderList,
    organizationAssignedModelOptions,
    providerListQuery.data,
    restrictToCloudProviders,
  ]);
  const openWorkModelsAvailable = hasOpenWorkModelsAvailable({
    providerConnectedIds,
    providers,
  });
  const openWorkModelsSyncing = shouldShowOpenWorkModelsSyncing({
    entitled: openWorkModelsEntitled,
    available: openWorkModelsAvailable,
    workspaceReady: Boolean(selectedWorkspaceId && opencodeClient),
    reloadPending: sessionProviderAuthSnapshot.cloudProviderServerSync?.reloadPending === true,
  });
  const organizationModelsEmpty = isOrganizationModelsEmpty({
    workspaceReady: Boolean(selectedWorkspaceId && opencodeClient),
    loading,
    restrictToCloud: restrictToCloudProviders,
    cloudProviderSyncReady,
    entitledModelCount: entitledModelOptions.length,
  });
  const modelPicker = useModelPicker({
    client: opencodeClient,
    baseUrl: opencodeBaseUrl,
    workspaceRoot: selectedWorkspaceRoot,
    onOpen: handleModelPickerOpen,
    fallbackOptions: organizationAssignedModelOptions,
    cloudProvidersEnabled: denAuth.isSignedIn,
  });
  // Which session the open model picker targets. Selecting a model while a
  // session is targeted remembers it for that conversation only; null means
  // the picker edits the global default (e.g. opened from the new-providers
  // toast). Composer "All models" carries the session id on the open event.
  const [modelPickerSessionId, setModelPickerSessionId] = useState<string | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      setModelPickerSessionId(typeof detail?.sessionId === "string" ? detail.sessionId : null);
    };
    window.addEventListener(openModelPickerEvent, handler);
    return () => window.removeEventListener(openModelPickerEvent, handler);
  }, []);
  const selectedModelUsesCloudProvider = Boolean(
    local.prefs.defaultModel && isCloudManagedProviderKey(local.prefs.defaultModel.providerID),
  );
  const selectedModelProviderList = selectedModelUsesCloudProvider
    ? cloudProviderList
    : providerListQuery.data;
  const entitledOrgDefaultModel = useMemo(() => {
    const runtimeOptions = providerListModelEntitlementOptions(
      cloudProviderList ?? providerListQuery.data,
    );
    return resolveEntitledOrgDefaultModel(
      runtimeOptions.length > 0 ? runtimeOptions : organizationAssignedModelOptions,
      {
        currentDefault: local.prefs.defaultModel,
        restrictToCloud: restrictToCloudProviders,
        checkRestriction: checkDesktopRestriction,
      },
    );
  }, [
    checkDesktopRestriction,
    cloudProviderList,
    local.prefs.defaultModel,
    organizationAssignedModelOptions,
    providerListQuery.data,
    restrictToCloudProviders,
  ]);
  useEffect(() => {
    if (entitledOrgDefaultModel) writeStoredDefaultModel(entitledOrgDefaultModel);
  }, [entitledOrgDefaultModel]);
  const selectedModelAvailabilityPending = isManagedModelAvailabilityPending({
    signedIn: denAuth.isSignedIn,
    selectedModelUsesCloudProvider,
    cloudProviderSyncReady,
    openWorkModelsSyncing,
  });
  const selectedModelUnavailable = Boolean(
    selectedWorkspaceId &&
      opencodeClient &&
      !loading &&
      !selectedModelAvailabilityPending &&
      local.prefs.defaultModel &&
      (!selectedModelUsesCloudProvider || cloudProviderSyncReady) &&
      (
        isDesktopProviderBlocked({
          providerId: local.prefs.defaultModel.providerID,
          checkRestriction: checkDesktopRestriction,
        }) ||
        (
          selectedModelProviderList &&
          restrictToCloudProviders &&
          !selectedModelProviderList.connected.some(
            (providerId) => providerId.trim() === local.prefs.defaultModel?.providerID.trim(),
          )
        ) ||
        (
          selectedModelProviderList &&
          !isModelAvailableInConnectedProviders(selectedModelProviderList, local.prefs.defaultModel)
        )
      ),
  );
  const selectedModelUnavailableKey = selectedModelUnavailable && local.prefs.defaultModel
    ? `${local.prefs.defaultModel.providerID}:${local.prefs.defaultModel.modelID}`
    : null;
  const autoOpenedUnavailableModelRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedModelUnavailableKey) {
      autoOpenedUnavailableModelRef.current = null;
      return;
    }
    if (!shouldAutoOpenUnavailableModelPicker({
      selectedModelUnavailableKey,
      signedIn: denAuth.isSignedIn,
      cloudProviderSyncReady,
      entitledOrgDefaultModel: Boolean(entitledOrgDefaultModel),
      organizationModelsEmpty,
      autoOpenedUnavailableModelKey: autoOpenedUnavailableModelRef.current,
    })) return;
    if (entitledOrgDefaultModel) {
      writeStoredDefaultModel(entitledOrgDefaultModel);
      return;
    }

    autoOpenedUnavailableModelRef.current = selectedModelUnavailableKey;
    modelPicker.setQuery("");
    modelPicker.setRecentProviderIds(new Set());
    modelPicker.setCompactOpen(false);
    modelPicker.setOpen(true);
  }, [cloudProviderSyncReady, denAuth.isSignedIn, entitledOrgDefaultModel, modelPicker.setCompactOpen, modelPicker.setOpen, modelPicker.setQuery, modelPicker.setRecentProviderIds, organizationModelsEmpty, selectedModelUnavailableKey]);

  const hasUsableModel = Boolean(
    local.prefs.defaultModel &&
      !selectedModelUnavailable &&
      !selectedModelAvailabilityPending,
  );
  const canCreateTask = Boolean(
    opencodeClient &&
      selectedWorkspaceId &&
      !loading &&
      !selectedWorkspaceError &&
      !selectedModelUnavailable &&
      !selectedModelAvailabilityPending,
  );

  const {
    activePermission,
    permissionReplyBusy,
    respondPermission,
    activeQuestion,
    questionReplyBusy,
    respondQuestion,
    todos,
  } = useSessionInteractions({
    client: opencodeClient,
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
    workspaceRoot: selectedWorkspaceRoot,
  });
  const modelUnavailableMessage = organizationModelsEmpty
    ? t("models.organization_models_empty")
    : selectedModelUnavailable
      ? t("models.model_unavailable_short")
      : null;
  const showPreparingStatus =
    !organizationModelsEmpty &&
    (effectiveLoading ||
      selectedModelAvailabilityPending ||
      (!canCreateTask && !routeError && !selectedWorkspaceError));

  useEffect(() => {
    if (!opencodeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      return;
    }

    let cancelled = false;

    const applyProviderState = (value: ProviderListResponse) => {
      if (cancelled) return;
      // When not signed in, filter out every cloud-managed provider key so
      // stale org imports and the hosted `openwork` catalog do not reappear.
      const hasCloudAuth = !!readDenSettings().authToken?.trim();
      const all = hasCloudAuth
        ? ((value.all ?? []) as ProviderListItem[])
        : ((value.all ?? []) as ProviderListItem[]).filter(
            (provider) => !isCloudManagedProviderKey(provider.id ?? ""),
          );
      const connected = hasCloudAuth
        ? (value.connected ?? [])
        : (value.connected ?? []).filter((id) => !isCloudManagedProviderKey(id));
      setProviders(all);
      setProviderConnectedIds(connected);
      // New-provider detection is handled globally by the provider auth
      // store's applyProviderListState, which fires dispatchNewProviders.
    };

    void (async () => {
      let disabledProviders: string[] = [];
      try {
        const config = unwrap(
          await opencodeClient.config.get({
            directory: selectedWorkspaceRoot || undefined,
          }),
        );
        disabledProviders = disabledProvidersFromConfig(config);
        if (!cancelled) setDisabledProviderIds(disabledProviders);
      } catch {
        // ignore config read failures and continue with provider discovery
      }

      try {
        applyProviderState(
          filterProviderList(
            await ensureProviderListQuery(getReactQueryClient(), {
              client: opencodeClient,
              baseUrl: opencodeBaseUrl,
              directory: selectedWorkspaceRoot || undefined,
            }),
            disabledProviders,
          ),
        );
      } catch {
        if (cancelled) return;
        setProviders([]);
        setProviderDefaults({});
        setProviderConnectedIds([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [opencodeBaseUrl, opencodeClient, selectedWorkspaceRoot, denSessionVersion]);

  const modelLabel = local.prefs.defaultModel
    ? resolveModelDisplayName(local.prefs.defaultModel.modelID)
    : t("session.default_model");

  const listSlashCommands = useCallback(async (): Promise<SlashCommandOption[]> => {
    // engineReloadVersion is included so the callback identity changes after
    // an engine reload, which invalidates the composer's command list cache
    // and causes it to re-fetch (picking up newly created skills).
    void engineReloadVersion;
    if (!opencodeClient) return [];
    return listCommands(opencodeClient, selectedWorkspaceRoot || undefined);
  }, [engineReloadVersion, opencodeClient, selectedWorkspaceRoot]);

  // Shared by the composer (plug menu, @ mentions) and the command palette.
  // Hidden and subagent-only entries are excluded — those are task-tool
  // delegation targets, not agents the user can run a session as.
  const listAgents = useCallback(async () => {
    // Include engineReloadVersion so the composer refetches after newly added
    // agent files become available, even when the inline picker is hidden.
    void engineReloadVersion;
    if (!opencodeClient) return [];
    const list = unwrap(await opencodeClient.app.agents());
    return list.filter((agent) => !agent.hidden && agent.mode !== "subagent");
  }, [engineReloadVersion, opencodeClient]);

  const handleOpenSettings = useCallback((route = "/settings/general", workspaceId = sidebarActiveWorkspaceId) => {
    const sessionId = workspaceId === sidebarActiveWorkspaceId ? selectedSessionId : null;
    const tab = route.replace(/^\/settings\/?/, "").replace(/^\/+|\/+$/g, "") || "general";
    const target = workspaceId ? workspaceSettingsRoute(workspaceId, tab) : route;
    writeActiveWorkspaceId(workspaceId || null);
    navigate(target, { state: { workspaceId, sessionId } });
  }, [navigate, selectedSessionId, sidebarActiveWorkspaceId]);

  const handleOpenExtensions = useCallback((path = "", workspaceId = sidebarActiveWorkspaceId) => {
    const sessionId = workspaceId === sidebarActiveWorkspaceId ? selectedSessionId : null;
    const extensionPath = path
      .replace(/^\/settings\/extensions\/?/, "")
      .replace(/^\/extensions\/?/, "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/^mcp$/, "mcps");
    const target = workspaceId
      ? workspaceExtensionsRoute(workspaceId, extensionPath)
      : globalExtensionsRoute(extensionPath);
    writeActiveWorkspaceId(workspaceId || null);
    navigate(target, { state: { workspaceId, sessionId } });
  }, [navigate, selectedSessionId, sidebarActiveWorkspaceId]);

  const extensionsMainOpen = /^\/(?:workspace\/[^/]+\/)?extensions(?:\/|$)/.test(location.pathname);

  const surfaceProps = useMemo(() => {
    if (!client || !selectedWorkspaceId || !selectedSessionId || !opencodeBaseUrl || !token || !opencodeClient) {
      return null;
    }

    // Transient-safety: when the user switches workspaces the URL-driven
    // selectedSessionId may still point at a session from the old workspace
    // for one render tick. Only block rendering when we KNOW the session
    // belongs to a different workspace (i.e., it exists in another
    // workspace's list). A brand-new session that hasn't been refreshed
    // into any list yet must still render so "New task" feels instant.
    let sessionOwnedByOtherWorkspace = false;
    for (const [workspaceId, sessions] of Object.entries(sessionsByWorkspaceId)) {
      if (workspaceId === selectedWorkspaceId) continue;
      if ((sessions ?? []).some((session) => session?.id === selectedSessionId)) {
        sessionOwnedByOtherWorkspace = true;
        break;
      }
    }
    if (sessionOwnedByOtherWorkspace) {
      return null;
    }

    // Note: do NOT include `client`, `workspaceId`, `sessionId`,
    // `opencodeBaseUrl`, or `openworkToken` here. SessionPage forwards those
    // explicitly to SessionSurface from the per-workspace endpoint resolved
    // by `resolveWorkspaceEndpoint`. If we leak them in here, the spread of
    // `surfaceProps` in SessionPage overrides those correct values with the
    // local server's, and remote workspaces silently end up calling the
    // local server with the local `rem_*` id.
    return {
      workspaceRoot: selectedWorkspaceRoot,
      roleplay: roleplaySurface,
      roleplayControls: roleplaySurface
        ? {
            turn: latestRoleplayTurn,
            busy: roleplayBusy,
            storySoFar: roleplaySurface.storySoFar,
            storySaving: bindRoleplaySession.isPending,
            compacted: roleplayCompacted,
            memoryBusy,
            revisionBusy,
            onExtractMemories: () => void handleExtractMemories(),
            onProposeRevision: () => void handleProposeRevision(),
            onSwipe: () => void handleRoleplaySwipe(),
            onSelectAlternative: (offset: number) => handleRoleplaySelectAlternative(offset),
            onBranch: (messageId?: string) => void handleRoleplayBranch(messageId),
            onSaveStorySoFar: (value: string) => void handleSaveStorySoFar(value),
            personas: roleplayPersonasQuery.data ?? [],
            personaId: roleplayBindingQuery.data?.binding?.personaId ?? "",
            onSelectPersona: (personaId: string) => void handleSelectRoleplayPersona(personaId),
            onChangeSettings: (settings: RoleplaySessionSettings) =>
              void handleChangeRoleplaySettings(settings),
            diagnostics:
              roleplayDiagnostics && roleplayDiagnostics.sessionId === selectedSessionId
                ? roleplayDiagnostics.diagnostics
                : null,
          }
        : null,
      developerMode: false,
      modelLabel,
      onModelClick: (sessionId?: string) => {
        setModelPickerSessionId(sessionId ?? null);
        modelPicker.setQuery("");
        modelPicker.setOpen(true);
      },
      providerCatalog,
      modelPickerOpen: modelPicker.compactOpen,
      modelUnavailable: selectedModelUnavailable,
      modelUnavailableMessage,
      organizationModelsEmpty,
      selectedModel: local.prefs.defaultModel ?? { providerID: "", modelID: "" },
      openWorkModelsEntitled,
      openWorkModelsSyncing,
      onRefreshOrganizationModels: refreshOrganizationModelAccess,
      onModelPickerOpenChange: (open: boolean) => {
        modelPicker.setCompactOpen(open);
        if (open) {
          void refreshCloudProviderSync("model_picker_open");
        }
      },
      onModelChange: (model: ModelRef) => {
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: model,
          modelVariant: previous.defaultModel?.providerID === model.providerID && previous.defaultModel.modelID === model.modelID
            ? previous.modelVariant
            : null,
        }));
        modelPicker.setCompactOpen(false);
      },
      providerConnectedCount: hasUsableModel ? 1 : providerConnectedIds.length,
      onOpenSettingsSection: (section: "commands" | "skills" | "mcps" | "plugins" | "extensions" | "providers") => {
        if (section === "providers") {
          handleOpenSettings("/settings/ai");
          return;
        }
        handleOpenExtensions(section === "skills" ? "skills" : section === "mcps" ? "mcps" : section === "plugins" ? "plugins" : "");
      },
      onSendDraft: async (draft: ComposerDraft, sessionId: string): Promise<CloudMcpSubmissionResult> => {
        const targetSessionId = sessionId.trim() || selectedSessionId;
        if (!targetSessionId) return { outcome: "cancelled", reason: "context_changed" };
        const text = (draft.resolvedText ?? draft.text).trim();
        // A roleplay turn can be director-only: the user steers out of character
        // without saying anything in it. That draft has no message text at all,
        // so without this it would be cancelled here and the instruction would
        // never reach the model, silently and with nothing shown to the user.
        const hasDirectorOnly = Boolean(draft.directorText?.trim());
        if (!text && draft.attachments.length === 0 && !hasDirectorOnly) {
          return { outcome: "cancelled", reason: "context_changed" };
        }
        // Per-conversation model memory: a session that picked its own model
        // sends with it (and its variant) instead of the global default.
        const sessionModelSelection = getSessionModelSelection(targetSessionId);
        const sendModel = sessionModelSelection?.model ?? local.prefs.defaultModel;
        const sendVariant = sessionModelSelection ? sessionModelSelection.variant : modelVariantValue;
        if (!sessionModelSelection && selectedModelUnavailable) throw new Error("Selected model is unavailable. Choose another model before sending.");

        return submitWithCloudMcpReadiness({
          // Temporarily bypass the pre-send Cloud MCP gate: it blocks every
          // message, including tasks that do not use connected services.
          skipGate: true,
          send: async () => {
            await sendWithRevertRollback({
              revertMessageId: draft.revertMessageId,
              abort: () => abortSessionSafe(opencodeClient, targetSessionId, selectedWorkspaceRoot || undefined),
              revert: async (messageId) => {
                const reverted = await revertSession(opencodeClient, targetSessionId, messageId);
                applySessionRevert(selectedWorkspaceId, reverted);
              },
              prompt: async () => {
                captureAnalyticsEvent("task_message_sent", {
                  mode: draft.mode ?? "prompt",
                  is_command: Boolean(draft.command),
                  attachment_count: draft.attachments.length,
                  text_length: text.length,
                  workspace_type: selectedWorkspace?.workspaceType ?? "unknown",
                  provider_id: sendModel?.providerID ?? null,
                  model_id: sendModel?.modelID ?? null,
                });
                markTaskRunStart(targetSessionId);
                // Den org adoption signals (auth-gated inside; no-op when signed out).
                // This remains inside the post-readiness send closure so a blocked
                // Cloud submission cannot create a run or report that one started.
                const projectDimension = readWorkspaceProjectDimension(selectedWorkspaceId);
                const telemetryDimensions = projectDimension
                  ? [{
                      type: "project",
                      label: projectDimension.label,
                    }]
                  : undefined;
                trackSessionActive(targetSessionId, telemetryDimensions);
                trackTaskStarted(targetSessionId, telemetryDimensions);

                if (draft.mode === "shell") {
                  await shellInSession(opencodeClient, targetSessionId, text);
                  return;
                }

                if (draft.command) {
                  const result = await opencodeClient.session.command({
                    sessionID: targetSessionId,
                    command: draft.command.name,
                    arguments: draft.command.arguments,
                  });
                  if (result.error) {
                    throw new Error(serializeSDKError(result.error));
                  }
                  return;
                }

                // Auto-compact fires here and nowhere else. Triggering it on a
                // timer or on transcript growth would let it run concurrently
                // with a regenerate's abort/revert/prompt chain against the same
                // session, which nothing else serialises.
                const roleplayTurnCount = roleplayTurnsQuery.data?.length ?? 0;
                // The transcript fetch is the expensive part and it is only
                // needed once a conversation is long enough to be a candidate,
                // so the cheap gates run first.
                const revertInFlightHere = revertInFlightRef.current === targetSessionId;
                if (roleplaySurface && sendModel && roleplayTurnCount >= MIN_TURNS_BEFORE_COMPACT && !revertInFlightHere) {
                  const decision = decideCompaction({
                    transcriptChars: await transcriptTextLength(opencodeClient, targetSessionId),
                    systemChars: roleplaySurface.storySoFar.length,
                    turnCount: roleplayTurnCount,
                    contextTokens: providerCatalog?.[sendModel.providerID]?.[sendModel.modelID]?.limit?.context,
                    revertInFlight: revertInFlightHere,
                  });
                  if (decision.shouldCompact) {
                    try {
                      await compactSession(opencodeClient, targetSessionId, sendModel, {
                        directory: selectedWorkspaceRoot || undefined,
                      });
                      setRoleplayCompacted(true);
                    } catch (error) {
                      // A failed compaction must not block the turn; the send
                      // still fits often enough that refusing it would be worse.
                      console.warn("[roleplay] auto-compact failed", error);
                    }
                  }
                }

                const parts = await draftToParts(draft, selectedWorkspaceRoot, targetSessionId, selectedWorkspaceEndpoint);
                const envSystemContext = await buildOpenworkEnvSystemContext(client, {
                  cacheKey: targetSessionId,
                  runtimeKey: environmentRuntimeKey,
                });
                // Roleplay sends take a different shape on the wire, and every
                // part of it is load-bearing: the agent is pinned rather than
                // read from the global preference, every tool is denied
                // explicitly, and `system` composes onto the environment context
                // instead of replacing it. See `app/roleplay/turn.ts`.
                // Lorebook keys are matched against the recent transcript plus
                // the message being sent, so an entry keyed on something the
                // user just typed fires for the reply to that message rather
                // than for the one after it.
                const scanMessages = roleplaySurface?.lorebooks.length
                  ? [
                      ...toScanMessages(
                        unwrap(await opencodeClient.session.messages({ sessionID: targetSessionId, limit: MAX_SCAN_DEPTH })) ?? [],
                      ),
                      { role: "user" as const, text },
                    ]
                  : [];
                const roleplayTurn = roleplaySurface
                  ? buildRoleplayTurn({
                      card: roleplaySurface.card,
                      persona: roleplaySurface.persona,
                      greeting: roleplaySurface.greeting,
                      // Both of these must match what the regenerate path passes.
                      // A send and its own regenerate composing different system
                      // strings reads as the model ignoring the user's notes.
                      storySoFar: roleplaySurface.storySoFar,
                      memories: roleplaySurface.memories,
                      lorebooks: roleplaySurface.lorebooks,
                      scanMessages,
                      settings: roleplaySurface.settings,
                      directorText: draft.directorText,
                      envContext: envSystemContext ?? null,
                    })
                  : null;
                if (roleplayTurn) {
                  setRoleplayDiagnostics({
                    sessionId: targetSessionId,
                    diagnostics: turnDiagnostics(roleplayTurn),
                  });
                }
                const result = await opencodeClient.session.promptAsync({
                  sessionID: targetSessionId,
                  parts,
                  model: sendModel ?? undefined,
                  ...(sendVariant ? { variant: sendVariant } : {}),
                  ...(roleplayTurn
                    ? roleplayTurn.prompt
                    : {
                        agent: selectedAgent ?? undefined,
                        ...(envSystemContext ? { system: envSystemContext } : {}),
                      }),
                });
                if (result.error) {
                  throw new Error(serializeSDKError(result.error));
                }
                if (roleplayTurn && draft.blocks?.length) {
                  void persistRoleplayTurn({
                    endpoint: selectedWorkspaceEndpoint,
                    listMessages: async (sessionId) => (await opencodeClient.session.messages({ sessionID: sessionId, limit: 4 })).data,
                    sessionId: targetSessionId,
                    turnId: createTurnId(Date.now(), Math.random().toString(36).slice(2, 8)),
                    userText: text,
                    blocks: draft.blocks,
                  });
                }
                // Remember what this conversation used last so returning to it
                // (or splitting it beside another session) keeps its own model.
                if (sendModel) {
                  useSessionModelStore.getState().setModel(targetSessionId, sendModel, sendVariant ?? null);
                }
              },
              unrevert: async () => {
                try {
                  await unrevertSession(opencodeClient, targetSessionId);
                } finally {
                  applySessionUnrevert(selectedWorkspaceId, targetSessionId);
                }
              },
              onUnrevertError: (error) => console.warn("[edit-resend] rollback failed", error),
            });
          },
        });
      },
      cloudMcpSubmissionState,
      onOpenConnect: () => handleOpenExtensions(),
      onDraftChange: () => {
        // Draft persistence will be wired once the full React shell owns session state.
      },
      attachmentsEnabled: true,
      attachmentsDisabledReason: null,
      modelVariantLabel,
      modelVariant: modelVariantValue,
      modelBehaviorOptions,
      onModelVariantChange: (value: string | null) => {
        local.setPrefs((previous) => ({ ...previous, modelVariant: value }));
      },
      agentLabel: selectedAgent ? selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1) : t("session.default_agent"),
      selectedAgent,
      listAgents,
      onSelectAgent: (agent: string | null) => setSelectedAgent(agent),
      listCommands: listSlashCommands,
      recentFiles: [],
      searchFiles: async (query: string) => {
        const trimmed = query.trim();
        if (!trimmed) return [];
        const result = unwrap(
          await opencodeClient.find.files({
            query: trimmed,
            dirs: "true",
            limit: 50,
            directory: selectedWorkspaceRoot || undefined,
          }),
        );
        return result;
      },
      isRemoteWorkspace: selectedWorkspace?.workspaceType === "remote",
      isSandboxWorkspace: selectedWorkspace ? isSandboxWorkspace(selectedWorkspace) : false,
      onRevertToMessage: async (messageId: string, sessionId: string) => {
        const targetSessionId = sessionId.trim() || selectedSessionId;
        if (!targetSessionId) return false;
        try {
          // Abort any running generation first; OpenCode rejects revert on busy sessions.
          await abortSessionSafe(opencodeClient, targetSessionId, selectedWorkspaceRoot || undefined);
          const reverted = await revertSession(opencodeClient, targetSessionId, messageId);
          // Stamp the revert cursor into the local caches so the transcript
          // rewinds immediately instead of waiting for a full reload.
          applySessionRevert(selectedWorkspaceId, reverted);
          return true;
        } catch (error) {
          console.warn("[revert] failed", error);
          toast.error(t("session.revert_failed"));
          return false;
        }
      },
      onRestoreRevertedSession: async (sessionId: string) => {
        const targetSessionId = sessionId.trim() || selectedSessionId;
        if (!targetSessionId) return false;
        try {
          await unrevertSession(opencodeClient, targetSessionId);
          applySessionUnrevert(selectedWorkspaceId, targetSessionId);
          return true;
        } catch (error) {
          console.warn("[unrevert] failed", error);
          toast.error(t("session.restore_failed"));
          return false;
        }
      },
      onForkAtMessage: (messageId: string | null, sessionId: string) => {
        void (async () => {
          const targetSessionId = sessionId.trim() || selectedSessionId;
          if (!targetSessionId) return;
          try {
            const forked = await forkSession(opencodeClient, targetSessionId, messageId ?? undefined);
            writeLastSessionFor(selectedWorkspaceId, forked.id);
            rememberPendingCreatedSession(selectedWorkspaceId, forked.id);
            setSessionsByWorkspaceId((current) => ({
              ...current,
              [selectedWorkspaceId]: [forked, ...(current[selectedWorkspaceId] ?? [])],
            }));
            navigateToWorkspaceSession(selectedWorkspaceId, forked.id);
            void refreshRouteState();
          } catch (error) {
            console.warn("[fork] failed", error);
            toast.error(t("session.branch_failed"));
          }
        })();
      },
      onChangeModel: (model: { providerID: string; modelID: string }) => {
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: model,
          modelVariant: previous.defaultModel?.providerID === model.providerID && previous.defaultModel.modelID === model.modelID
            ? previous.modelVariant
            : null,
        }));
      },
      environmentRuntimeKey,
      onApplyEnvironmentChanges: isDesktopRuntime() && selectedWorkspace?.workspaceType !== "remote"
        ? handleApplyEnvironmentChanges
        : undefined,
    };
  }, [
    client,
    modelPicker.compactOpen,
    handleOpenExtensions,
    handleOpenSettings,
    hasUsableModel,
    handleApplyEnvironmentChanges,
    environmentRuntimeKey,
    local,
    listAgents,
    listSlashCommands,
    modelBehaviorOptions,
    cloudMcpSubmissionState,
    modelLabel,
    modelUnavailableMessage,
    organizationModelsEmpty,
    modelVariantLabel,
    modelVariantValue,
    navigate,
    providerCatalog,
    openWorkModelsEntitled,
    openWorkModelsSyncing,
    refreshCloudProviderSync,
    refreshOrganizationModelAccess,
    opencodeBaseUrl,
    opencodeClient,
    providerConnectedIds,
    roleplaySurface,
    // Every value `roleplayControls` closes over. Without these the controls
    // object is frozen at the last unrelated recompute: the busy flags never
    // reach the buttons, so a running generation showed no spinner and stayed
    // clickable, and the swipe counter never followed the stored turn.
    latestRoleplayTurn,
    roleplayBusy,
    roleplayCompacted,
    memoryBusy,
    revisionBusy,
    bindRoleplaySession.isPending,
    // The handlers themselves are declared below this memo, so they cannot be
    // listed here. They are reached through these values instead: every one of
    // them changes when a roleplay interaction starts or finishes.
    selectedAgent,
    selectedSessionId,
    selectedModelUnavailable,
    selectedWorkspace,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    sessionsByWorkspaceId,
    submitWithCloudMcpReadiness,
    token,
  ]);
  const cloudWorkspaceMainContentDecision = mapCloudWorkspaceMainContentDecision({
    status: cloudWorkspace.viewModel.variant,
    hasWorkspaces: Boolean(surfaceProps),
    gatewayMode: cloudWorkspace.gatewayMode && cloudWorkspace.visible,
  });
  const cloudWorkspaceReadyForRouteErrors =
    !cloudWorkspace.gatewayMode ||
    !cloudWorkspace.visible ||
    cloudWorkspaceStatusHasReadyContent(cloudWorkspace.viewModel.variant);
  const cloudWorkspaceMainContentTakeover = !bootOverlayVisible && cloudWorkspaceMainContentDecision === "takeover" ? (
    <CloudWorkspaceBootTakeover decision={cloudWorkspaceMainContentDecision} />
  ) : null;
  const gatedRouteNotFoundMessage = cloudWorkspaceReadyForRouteErrors ? routeNotFoundMessage : null;

  // Workspace-scoped wiring for the empty-state hero's full composer. Unlike
  // `surfaceProps` this exists without a selected session, so the hero offers
  // the same skills/commands/agent/model controls before the session is
  // created. Model and agent choices land in the same route-level state the
  // session composer reads, so they carry into the created session.
  const newTaskComposerContext = useMemo<NewTaskComposerContext | null>(() => {
    return {
      client,
      workspaceId: selectedWorkspaceId || null,
      selectedModel: local.prefs.defaultModel ?? { providerID: "", modelID: "" },
      modelOptions: organizationAssignedModelOptions,
      modelUnavailable: selectedModelUnavailable,
      modelUnavailableMessage,
      organizationModelsEmpty,
      onRefreshOrganizationModels: refreshOrganizationModelAccess,
      modelPickerOpen: modelPicker.compactOpen,
      onModelPickerOpenChange: (open: boolean) => {
        modelPicker.setCompactOpen(open);
        if (open) {
          void sessionProviderAuthStore.refreshCloudOrgProviders({ force: true }).catch(() => undefined);
          void refreshCloudProviderSync("model_picker_open");
        }
      },
      onModelChange: (model: ModelRef) => {
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: model,
          modelVariant: previous.defaultModel?.providerID === model.providerID && previous.defaultModel.modelID === model.modelID
            ? previous.modelVariant
            : null,
        }));
        modelPicker.setCompactOpen(false);
      },
      openWorkModelsEntitled,
      openWorkModelsSyncing,
      modelVariantLabel,
      modelVariant: modelVariantValue,
      modelBehaviorOptions,
      onModelVariantChange: (value: string | null) => {
        local.setPrefs((previous) => ({ ...previous, modelVariant: value }));
      },
      agentLabel: selectedAgent ? selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1) : t("session.default_agent"),
      selectedAgent,
      listAgents,
      onSelectAgent: (agent: string | null) => setSelectedAgent(agent),
      listCommands: listSlashCommands,
      searchFiles: async (query: string) => {
        const trimmed = query.trim();
        if (!trimmed || !opencodeClient) return [];
        const result = unwrap(
          await opencodeClient.find.files({
            query: trimmed,
            dirs: "true",
            limit: 50,
            directory: selectedWorkspaceRoot || undefined,
          }),
        );
        return result;
      },
      isRemoteWorkspace: selectedWorkspace?.workspaceType === "remote",
      isSandboxWorkspace: selectedWorkspace ? isSandboxWorkspace(selectedWorkspace) : false,
      onOpenSettingsSection: (section: "commands" | "skills" | "mcps" | "plugins" | "extensions") => {
        handleOpenExtensions(section === "skills" ? "skills" : section === "mcps" ? "mcps" : section === "plugins" ? "plugins" : "");
      },
    };
  }, [
    client,
    handleOpenExtensions,
    handleOpenSettings,
    listAgents,
    listSlashCommands,
    local,
    modelUnavailableMessage,
    modelBehaviorOptions,
    modelPicker,
    modelVariantLabel,
    modelVariantValue,
    opencodeClient,
    openWorkModelsEntitled,
    openWorkModelsSyncing,
    organizationAssignedModelOptions,
    organizationModelsEmpty,
    refreshCloudProviderSync,
    refreshOrganizationModelAccess,
    selectedAgent,
    selectedModelUnavailable,
    selectedWorkspace,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    sessionProviderAuthStore,
    setSelectedAgent,
  ]);

  const handleOpenCreateWorkspace = useCallback(() => {
    if (!canCreateWorkspaces()) return;
    // Respect the org-level `allowMultipleWorkspaces` restriction (dev
    // #1505). If the checker returns true, the admin has disabled
    // adding further workspaces; surface a friendly notice instead of
    // opening the modal.
    if (
      workspaces.length > 0 &&
      checkDesktopRestriction({ restriction: "allowMultipleWorkspaces" })
    ) {
      restrictionNotice.show({
        title: "Additional workspaces are restricted",
        message:
          "Your organization administrator has restricted access to adding additional workspaces.",
      });
      return;
    }
    setCreateWorkspaceRemoteError(null);
    setCreateWorkspaceOpen(true);
  }, [checkDesktopRestriction, restrictionNotice, workspaces.length]);

  const handleOpenRenameWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    setRenameWorkspaceId(workspaceId);
    setRenameWorkspaceTitle(
      workspace.displayName?.trim() ||
        workspace.name?.trim() ||
        workspace.path?.trim() ||
        "",
    );
  }, [workspaces]);

  const handleSaveRenameWorkspace = useCallback(async () => {
    if (!renameWorkspaceId) return;
    const trimmed = renameWorkspaceTitle.trim();
    if (!trimmed) return;
    setRenameWorkspaceBusy(true);
    try {
      if (!client) {
        toast.error("OpenWork server is unavailable. Reconnect the server before renaming workspaces.");
        return;
      }
      await client.updateWorkspaceDisplayName(renameWorkspaceId, trimmed);
      setRenameWorkspaceId(null);
      setRenameWorkspaceTitle("");
      await refreshRouteState();
    } catch (error) {
      toast.error("Workspace rename failed", {
        description: describeRouteError(error),
      });
    } finally {
      setRenameWorkspaceBusy(false);
    }
  }, [client, refreshRouteState, renameWorkspaceId, renameWorkspaceTitle]);

  const handleRevealWorkspace = useCallback(async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const path = workspace?.path?.trim();
    if (!path || !isDesktopRuntime()) return;
    try {
      await revealDesktopItemInDir(path);
    } catch {
      // ignore
    }
  }, [workspaces]);

  const handleShareWorkspace = useCallback((workspaceId: string) => {
    shareWorkspaceState.openShareWorkspace(workspaceId);
  }, [shareWorkspaceState]);

  const handleSaveShareRemoteAccess = useCallback(
    async (enabled: boolean) => {
      if (!isDesktopRuntime()) return;
      await remoteAccessRestart.save(enabled);
    },
    [remoteAccessRestart],
  );

  const handleExportWorkspaceConfig = useCallback(
    async (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
      if (!workspace) return;
      const endpoint = endpointForWorkspace(workspace);
      if (endpoint) {
        const payload = await endpoint.client.exportWorkspace(endpoint.workspaceId);
        downloadWorkspaceJson(workspaceExportFilename(workspace), payload);
        return;
      }
      throw new Error("OpenWork server is unavailable. Reconnect the server before exporting workspace config.");
    },
    [endpointForWorkspace, workspaces],
  );

  const handleForgetWorkspace = useCallback(
    async (workspaceId: string) => {
      if (typeof window !== "undefined") {
        const message =
          t("workspace_list.remove_confirm") ||
          "Remove this workspace from the sidebar?";
        if (!window.confirm(message)) return;
      }
      // Remove from both stores so the next refresh can't resurrect the row
      // from whichever list wins the merge.
      if (client) {
        await client.deleteWorkspace(workspaceId).catch(() => undefined);
      }
      if (isDesktopRuntime()) {
        await workspaceForget(workspaceId).catch(() => undefined);
      }
      if (selectedWorkspaceId === workspaceId) {
        setLegacySelectedWorkspaceId("");
        writeActiveWorkspaceId(null);
        navigate(legacySessionRoute());
      }
      forgetWorkspaceMemory(workspaceId);
      sessionManagementStore.getState().forgetWorkspace(workspaceId);
      await refreshRouteState();
    },
    [client, navigate, refreshRouteState, selectedWorkspaceId],
  );


  const handleCreateTaskInWorkspace = useCallback(async (workspaceId: string): Promise<string | null> => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (
      !workspace ||
      loading ||
      retryingWorkspaceIds.includes(workspaceId)
    ) {
      return null;
    }
    const endpoint = endpointForWorkspace(workspace);
    if (!endpoint || !endpoint.token) {
      return null;
    }
    const workspaceClient = createClient(
      endpoint.opencodeBaseUrl,
      workspace.path?.trim() || undefined,
      { token: endpoint.token, mode: "openwork" },
    );
    try {
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      setRouteError(null);
      const session = unwrap(
        await workspaceClient.session.create({ directory: workspace.path?.trim() || undefined }),
      );
      if (workspaceId === selectedWorkspaceId) {
        void refreshCloudProviderSync("new_chat");
      }
      captureAnalyticsEvent("task_created", {
        source: "new_task",
        workspace_type: workspace.workspaceType ?? "unknown",
      });
      toast.dismiss(taskCreateUnavailableToastId(workspaceId));
      toast.dismiss();
      setLegacySelectedWorkspaceId(workspaceId);
      writeActiveWorkspaceId(workspaceId || null);
      writeLastSessionFor(workspaceId, session.id);
      rememberPendingCreatedSession(workspaceId, session.id);
      setSessionsByWorkspaceId((current) => {
        const next = {
          ...current,
          [workspaceId]: [session, ...(current[workspaceId] ?? [])],
        };
        sessionsByWorkspaceIdRef.current = next;
        return next;
      });
      navigateToWorkspaceSession(workspaceId, session.id);
      focusPromptSoon();
      void refreshRouteState();
      return session.id;
    } catch (error) {
      const message = describeTaskCreateError(error);
      setRouteError(message);
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: message }));
      toast.error("OpenCode unavailable", {
        id: taskCreateUnavailableToastId(workspaceId),
        description: message,
        action: {
          label: "Retry",
          onClick: () => void handleCreateTaskInWorkspace(workspaceId),
        },
        duration: Infinity,
      });
      if (isTransientStartupError(message)) {
        setRetryingWorkspaceIds((current) => Array.from(new Set([...current, workspaceId])));
        if (startupRetryTimerRef.current === null) {
          startupRetryTimerRef.current = window.setTimeout(() => {
            startupRetryTimerRef.current = null;
            void refreshRouteState({ supersede: true });
          }, 1_000);
        }
      }
      return null;
    }
  }, [endpointForWorkspace, loading, navigateToWorkspaceSession, refreshCloudProviderSync, refreshRouteState, rememberPendingCreatedSession, retryingWorkspaceIds, selectedWorkspaceId, workspaces]);

  // Starting a roleplay chat is "create an ordinary session, then bind it". The
  // binding is what every roleplay behaviour keys off, so nothing else in the
  // session lifecycle has to know this session was created differently.

  /**
   * Run one character-generation call and hand back its raw text.
   *
   * Generation needs a session because a prompt is the only way to reach a model,
   * but it is not a conversation: the session is created, used once, and deleted.
   * It is deliberately not created through `handleCreateTaskInWorkspace`, which
   * navigates to the new session and makes it the user's active chat.
   *
   * The tool boundary comes in with the request and is spread last, so nothing
   * here can widen it — this route never builds a tool map of its own.
   */
  // Stable ids so the "working…" toast is replaced by its own outcome instead of
  // stacking a second one under it.
  const ROLEPLAY_MEMORY_TOAST_ID = "roleplay-memory-extract";
  const ROLEPLAY_GREETING_TOAST_ID = "roleplay-greeting";
  const ROLEPLAY_REVISION_TOAST_ID = "roleplay-card-revision";

  const handleRunGeneration = useCallback(async (
    request: GenerationRequest,
    parentSessionId?: string,
  ): Promise<string> => {
    if (!opencodeClient) throw new Error("No workspace is connected.");
    const directory = selectedWorkspaceRoot || undefined;
    const { text, ...promptOptions } = request;
    // A child session, not a root one. A prompt needs a session, but this is not
    // a conversation the user is having: as a root session it appeared in the
    // sidebar, and being the newest it could become the selected one.
    // The parent is what keeps this out of the sidebar: only root sessions are
    // listed. The caller passes one explicitly because the library page has no
    // selected session, and without a parent this scratch session is created as
    // a root and shows up as a conversation the user never started.
    // Last resort when neither is available — generating from the character
    // library, where nothing is selected. Attaching a scratch session to an
    // unrelated conversation is not meaningful, but it is invisible: children
    // are never listed, and the alternative is a stray "Character generation"
    // row in the user's sidebar.
    const parent = parentSessionId ?? selectedSessionId ?? (sessionsByWorkspaceId[selectedWorkspaceId] ?? [])[0]?.id;
    const session = unwrap(
      await opencodeClient.session.create({
        directory,
        title: "Character generation",
        ...(parent ? { parentID: parent } : {}),
      }),
    );
    const reply = unwrap(
      await opencodeClient.session.prompt({
        sessionID: session.id,
        ...(directory ? { directory } : {}),
        parts: [{ type: "text", text }],
        model: local.prefs.defaultModel ?? undefined,
        ...promptOptions,
      }),
    );
    // Deliberately not deleted. `session.prompt` resolves before the engine has
    // finished flushing the message's parts, so removing the session here raced
    // those writes and failed them ("insert into part ..."). It also left the
    // app pointed at a session id that no longer existed whenever this one had
    // become the selected session. A child session is not listed, so leaving it
    // costs a row and nothing else.
    return (reply.parts ?? [])
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("");
  }, [
    local.prefs.defaultModel,
    opencodeClient,
    selectedSessionId,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    sessionsByWorkspaceId,
  ]);

  /**
   * Start a roleplay session, opening on the line the user chose.
   *
   * A generated opening is written in a second binding update rather than being
   * awaited before the first: the session is created, bound, and navigated to
   * immediately, so a slow generation leaves the user in their conversation
   * reading the card's greeting instead of staring at a spinner. When it lands,
   * the greeting is replaced in place.
   */
  const handleStartRoleplayChat = useCallback(async (
    characterId: string,
    personaId: string,
    opening: RoleplayOpening = { kind: "card" },
  ) => {
    if (!selectedWorkspaceId) return;
    const sessionId = await handleCreateTaskInWorkspace(selectedWorkspaceId);
    if (!sessionId) return;
    const binding = {
      sessionId,
      characterId,
      personaId,
      storySoFar: "",
      greeting: opening.kind === "alternate" ? opening.text : "",
      // Every field unset: a new conversation follows the app's defaults, and
      // storing them here would freeze them at today's values.
      settings: { disabledLorebookIds: [], systemPrompt: "" },
      boundAt: Date.now(),
    };
    await bindRoleplaySession.mutateAsync(binding);
    if (opening.kind !== "generate") return;

    const endpoint = selectedWorkspaceEndpoint;
    if (!endpoint || !opencodeClient) return;
    // The transcript shows a written-in indicator and the composer is blocked
    // while this runs, so no toast: the state is already on screen, in the
    // place the greeting will appear.
    setGreetingPendingSessionId(sessionId);
    try {
      const [character, memories, personas] = await Promise.all([
        endpoint.client.getRoleplayCharacter(endpoint.workspaceId, characterId),
        endpoint.client.listRoleplayMemories(endpoint.workspaceId, characterId),
        endpoint.client.listRoleplayPersonas(endpoint.workspaceId),
      ]);
      const persona = personas.personas.find((entry) => entry.id === personaId) ?? personas.personas[0];
      const raw = await handleRunGeneration(
        buildGreetingRequest({
          card: character.character.card,
          persona: persona?.persona ?? { name: "", description: "" },
          ...(character.character.charSubstitutionName ? { charName: character.character.charSubstitutionName } : {}),
          memories: memories.memories,
        }),
        // The conversation this opening belongs to. Without it the generation
        // session is created as a root and appears in the sidebar.
        sessionId,
      );
      const parsed = parseGeneratedGreeting(raw);
      if (!parsed.ok) {
        // Falling back to the card's greeting, which is what unblocking reveals.
        toast.error("Could not write an opening", {
          id: ROLEPLAY_GREETING_TOAST_ID,
          description: `${parsed.error} The character's usual greeting is being used instead.`,
        });
        return;
      }
      await bindRoleplaySession.mutateAsync({ ...binding, greeting: parsed.text });
    } catch (error) {
      toast.error("Could not write an opening", {
        id: ROLEPLAY_GREETING_TOAST_ID,
        description:
          error instanceof Error
            ? error.message
            : "The character's usual greeting is being used instead.",
      });
    } finally {
      // Unblocks whatever happened. A conversation stuck behind a failed
      // generation would be worse than one that opens on the card's greeting.
      setGreetingPendingSessionId(null);
    }
  }, [
    bindRoleplaySession,
    handleCreateTaskInWorkspace,
    handleRunGeneration,
    opencodeClient,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
  ]);

  /**
   * Regenerate the latest reply.
   *
   * The order is forced by the engine, not chosen: the reply must be copied
   * app-side *before* the revert, because the engine destroys it the moment the
   * next prompt is dispatched — and it does that even when the prompt fails,
   * clearing the revert cursor with it. `unrevert()` therefore cannot roll this
   * back, which is why there is no call to it here. See
   * `reports/swipe-semantics-spike.md`.
   */
  const handleRoleplaySwipe = useCallback(async () => {
    const turn = latestRoleplayTurn;
    const endpoint = selectedWorkspaceEndpoint;
    if (!turn || !endpoint || !opencodeClient || !roleplaySurface || !selectedSessionId) return;

    setRoleplayBusy(true);
    revertInFlightRef.current = selectedSessionId;
    // Hoisted: the capture is persisted before anything can fail, so the failure
    // path has to reason from it rather than from the pre-swipe turn. Reading
    // the pre-swipe turn instead would report "no saved copy" about a copy that
    // was saved a moment earlier.
    let capturedTurn: RoleplayTurnRecord | null = null;
    try {
      const existing = unwrap(await opencodeClient.session.messages({ sessionID: selectedSessionId, limit: 4 }));
      const reply = [...(existing ?? [])].reverse().find((entry) => entry.info.role === "assistant");
      if (!reply) return;
      const replyText = (reply.parts ?? [])
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("");

      const plan = planSwipe({
        turn,
        currentReply: { text: replyText, messageId: reply.info.id },
        now: Date.now(),
      });
      capturedTurn = plan.turn;
      // Persisted first. After the revert this reply no longer exists anywhere.
      await saveRoleplayTurn.mutateAsync(plan.turn);

      await abortSessionSafe(opencodeClient, selectedSessionId, selectedWorkspaceRoot || undefined);
      const reverted = await revertSession(opencodeClient, selectedSessionId, plan.revertMessageId);
      applySessionRevert(selectedWorkspaceId, reverted);

      const envSystemContext = await buildOpenworkEnvSystemContext(client, {
        cacheKey: selectedSessionId,
        runtimeKey: environmentRuntimeKey,
      });
      // Director text is recomposed from the stored blocks, so the regenerated
      // reply runs against the same steering the user gave the first time.
      const compiled = compileBlocks(plan.turn.blocks);
      const rebuilt = buildRoleplayTurn({
        card: roleplaySurface.card,
        persona: roleplaySurface.persona,
        greeting: roleplaySurface.greeting,
        storySoFar: roleplaySurface.storySoFar,
        memories: roleplaySurface.memories,
        lorebooks: roleplaySurface.lorebooks,
        // The transcript as it stood before the revert, plus the message being
        // replayed: a regenerate has to match the same entries the original send
        // did, or the character loses world knowledge it just used.
        scanMessages: [...toScanMessages(existing ?? []), { role: "user" as const, text: plan.userText }],
        // Live settings, not the ones the original send ran with: a change made
        // in the panel is meant to be testable by regenerating the reply that
        // prompted it.
        settings: roleplaySurface.settings,
        directorText: compiled.directorText,
        envContext: envSystemContext ?? null,
      });
      setRoleplayDiagnostics({ sessionId: selectedSessionId, diagnostics: turnDiagnostics(rebuilt) });

      const sessionModelSelection = getSessionModelSelection(selectedSessionId);
      // Same model *and* variant as an ordinary send. Dropping the variant here
      // would quietly regenerate against the provider's default reasoning mode,
      // which reads as the character changing rather than as a lost setting.
      const swipeVariant = sessionModelSelection ? sessionModelSelection.variant : modelVariantValue;
      // The synchronous prompt, not `promptAsync`. Measured against the real
      // engine: `prompt_async` answers 204 in ~11ms with nothing yet written,
      // so reading the transcript straight afterwards captured the *previous*
      // state — an empty reply and a stale message id, which the next
      // regenerate would then try to revert at. The sync call returns the
      // settled assistant message itself, ids included.
      const regenerated = unwrap(
        await opencodeClient.session.prompt({
          sessionID: selectedSessionId,
          // Never `parts: []` — the engine accepts it and blanks the user's message.
          parts: [{ type: "text", text: plan.userText }],
          model: sessionModelSelection?.model ?? local.prefs.defaultModel ?? undefined,
          ...(swipeVariant ? { variant: swipeVariant } : {}),
          ...rebuilt.prompt,
        }),
      );

      // The engine minted new ids for both the user message and the reply. The
      // turn has to follow them or the next regenerate reverts at a message that
      // no longer exists. The reply carries its own id; the user message id is
      // read back from the settled transcript.
      const settled = unwrap(await opencodeClient.session.messages({ sessionID: selectedSessionId, limit: 4 })) ?? [];
      const newUser = [...settled].reverse().find((entry) => entry.info.role === "user");
      if (newUser) {
        await saveRoleplayTurn.mutateAsync(
          applySwipeResult(plan.turn, {
            userMessageId: newUser.info.id,
            replyText: (regenerated.parts ?? [])
              .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
              .map((part) => part.text)
              .join(""),
            replyMessageId: regenerated.info.id,
            now: Date.now(),
          }),
        );
      }
      await refreshRouteState();
    } catch (error) {
      const repair = repairAfterFailedSwipe(capturedTurn ?? turn);
      if (repair.danglingUserMessage) {
        toast.error("Could not regenerate", {
          description: "The previous reply was discarded by the engine and there was no saved copy to restore.",
        });
      } else {
        // Points the turn back at the last reply that actually exists, so the
        // transcript and the swipe counter agree without the user having to
        // click "previous" to resynchronise them.
        try {
          await saveRoleplayTurn.mutateAsync(repair.turn);
        } catch (repairError) {
          console.warn("[roleplay] could not restore the previous reply", repairError);
        }
        toast.error("Could not regenerate", { description: "Showing the previous reply." });
      }
      console.warn("[roleplay] regenerate failed", error);
    } finally {
      revertInFlightRef.current = null;
      setRoleplayBusy(false);
    }
  }, [
    client,
    environmentRuntimeKey,
    latestRoleplayTurn,
    local.prefs.defaultModel,
    opencodeClient,
    refreshRouteState,
    roleplaySurface,
    saveRoleplayTurn,
    selectedSessionId,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
  ]);

  const handleRoleplaySelectAlternative = useCallback((offset: number) => {
    if (!latestRoleplayTurn) return;
    const next = selectAlternative(latestRoleplayTurn, offset);
    if (next !== latestRoleplayTurn) void saveRoleplayTurn.mutateAsync(next);
  }, [latestRoleplayTurn, saveRoleplayTurn]);

  /**
   * Branch a roleplay conversation.
   *
   * The engine's fork copies the transcript and knows nothing about roleplay, so
   * the branch has to be bound to the same character here. Without that it opens
   * as an ordinary chat holding a roleplay transcript: no greeting, no compiled
   * character prompt, no tool denial — which is why every fork entry point in a
   * roleplay session routes through this rather than through the generic one.
   *
   * The binding is written *before* navigating. Arriving first would render the
   * branch unbound for a beat and flash the greeting away.
   */
  const handleRoleplayBranch = useCallback(async (messageId?: string) => {
    if (!opencodeClient || !selectedSessionId || !selectedWorkspaceEndpoint || !roleplaySurface) return;
    const binding = roleplayBindingQuery.data?.binding;
    if (!binding) {
      // Refusing rather than forking unbound: a branch with no character is not
      // a roleplay branch, and the user would only find out by looking at it.
      toast.error("Could not branch this conversation", {
        description: "This session is not bound to a character.",
      });
      return;
    }
    try {
      const forked = await forkSession(opencodeClient, selectedSessionId, messageId);
      await selectedWorkspaceEndpoint.client.putRoleplaySessionBinding(selectedWorkspaceEndpoint.workspaceId, {
        ...binding,
        sessionId: forked.id,
        boundAt: Date.now(),
      });
      // Registered the same way an ordinary branch is, so the sidebar shows it
      // immediately instead of waiting for the next list refresh.
      writeLastSessionFor(selectedWorkspaceId, forked.id);
      rememberPendingCreatedSession(selectedWorkspaceId, forked.id);
      setSessionsByWorkspaceId((current) => ({
        ...current,
        [selectedWorkspaceId]: [forked, ...(current[selectedWorkspaceId] ?? [])],
      }));
      navigateToWorkspaceSession(selectedWorkspaceId, forked.id);
      void refreshRouteState();
    } catch (error) {
      toast.error("Could not branch this conversation", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [
    navigateToWorkspaceSession,
    opencodeClient,
    refreshRouteState,
    rememberPendingCreatedSession,
    roleplayBindingQuery.data,
    roleplaySurface,
    selectedSessionId,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
  ]);

  /**
   * Ask the model what this conversation is worth remembering.
   *
   * User-triggered rather than automatic at compaction. Extraction is a whole
   * extra completion over the transcript, and running it unasked on every long
   * conversation spends the user's money on a review dialog they may not want.
   *
   * Nothing is written here. The proposals go to the review dialog, and only
   * what a person keeps is persisted — a memory that misreads the transcript
   * becomes a permanent false fact the character repeats with confidence.
   */
  const handleExtractMemories = useCallback(async () => {
    if (!opencodeClient || !selectedSessionId || !roleplaySurface) return;
    if (memoryBusy) return;
    setMemoryBusy(true);
    // A model call over the whole transcript takes as long as it takes. The
    // button's own spinner is a small icon, so the work is announced here too
    // and the outcome replaces this toast rather than stacking under it.
    toast.info("Reading the conversation…", {
      id: ROLEPLAY_MEMORY_TOAST_ID,
      description: "Working out what the character should remember.",
      duration: Infinity,
    });
    try {
      const history = unwrap(await opencodeClient.session.messages({ sessionID: selectedSessionId })) ?? [];
      const transcript = buildTranscriptText(
        history
          .filter((entry) => entry.info.role === "user" || entry.info.role === "assistant")
          .map((entry) => ({
            role: entry.info.role === "user" ? "user" as const : "assistant" as const,
            text: (entry.parts ?? [])
              .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
              .map((part) => part.text)
              .join(""),
          })),
        roleplaySurface.characterName || "The character",
        roleplaySurface.persona.name || "User",
      );
      if (!transcript.trim()) {
        toast.info("Nothing to remember yet", {
          id: ROLEPLAY_MEMORY_TOAST_ID,
          description: "This conversation has no exchanges.",
          duration: 4_000,
        });
        return;
      }

      const raw = await handleRunGeneration(
        buildMemoryExtractRequest({ transcript, charName: roleplaySurface.characterName || "The character" }),
      );
      const parsed = parseMemoryProposals(raw, roleplaySurface.memories);
      if (!parsed.ok) {
        toast.error("Could not read what the model proposed", {
          id: ROLEPLAY_MEMORY_TOAST_ID,
          description: parsed.error,
          duration: 6_000,
        });
        return;
      }
      toast.dismiss(ROLEPLAY_MEMORY_TOAST_ID);
      setMemoryProposals(parsed.proposals);
      setMemoryReviewOpen(true);
    } catch (error) {
      toast.error("Could not work out what to remember", {
        id: ROLEPLAY_MEMORY_TOAST_ID,
        description: error instanceof Error ? error.message : undefined,
        duration: 6_000,
      });
    } finally {
      setMemoryBusy(false);
    }
  }, [handleRunGeneration, memoryBusy, opencodeClient, roleplaySurface, selectedSessionId]);

  const handleKeepMemories = useCallback(async (texts: string[]) => {
    if (!roleplaySurface) return;
    setMemoryBusy(true);
    try {
      for (const text of texts) {
        await saveRoleplayMemory.mutateAsync(
          createMemory({
            id: createMemoryId(Date.now(), Math.random().toString(36).slice(2, 8)),
            characterId: roleplaySurface.characterId,
            text,
            source: "extracted",
            ...(selectedSessionId ? { sessionId: selectedSessionId } : {}),
            now: Date.now(),
          }),
        );
      }
      toast.success(`${roleplaySurface.characterName || "The character"} will remember ${texts.length === 1 ? "that" : `those ${texts.length}`}`);
      setMemoryReviewOpen(false);
      setMemoryProposals([]);
    } catch (error) {
      toast.error("Could not save the memories", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setMemoryBusy(false);
    }
  }, [roleplaySurface, saveRoleplayMemory, selectedSessionId]);

  /**
   * Ask the character what its own card gets wrong.
   *
   * Director notes are pulled from the stored turns rather than from the
   * transcript, because they never went into message history — they were split
   * out into `system` at send time. They are the strongest evidence available:
   * every other signal is inference, while a director note is the user stating
   * in plain words what was wrong.
   *
   * Nothing is applied here. The proposals go to a per-field review.
   */
  const handleProposeRevision = useCallback(async () => {
    if (!opencodeClient || !selectedSessionId || !roleplaySurface) return;
    if (revisionBusy) return;
    setRevisionBusy(true);
    toast.info("Reading the conversation back…", {
      id: ROLEPLAY_REVISION_TOAST_ID,
      description: "Looking for what the card gets wrong.",
      duration: Infinity,
    });
    try {
      const directorNotes = (roleplayTurnsQuery.data ?? [])
        .flatMap((turn) => turn.blocks)
        .filter((block) => block.type === "director")
        .map((block) => block.text.trim())
        .filter(Boolean);

      const history = unwrap(await opencodeClient.session.messages({ sessionID: selectedSessionId })) ?? [];
      const transcript = buildTranscriptText(
        history
          .filter((entry) => entry.info.role === "user" || entry.info.role === "assistant")
          .map((entry) => ({
            role: entry.info.role === "user" ? "user" as const : "assistant" as const,
            text: (entry.parts ?? [])
              .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
              .map((part) => part.text)
              .join(""),
          })),
        roleplaySurface.characterName || "The character",
        roleplaySurface.persona.name || "User",
      );
      if (!transcript.trim() && directorNotes.length === 0) {
        toast.info("Nothing to go on yet", {
          id: ROLEPLAY_REVISION_TOAST_ID,
          description: "This conversation has no exchanges.",
          duration: 4_000,
        });
        return;
      }

      const raw = await handleRunGeneration(
        buildRevisionRequest({ card: roleplaySurface.card, directorNotes, transcript }),
      );
      const parsed = parseRevisionProposals(raw, roleplaySurface.card);
      if (!parsed.ok) {
        toast.error("Could not read what the model proposed", {
          id: ROLEPLAY_REVISION_TOAST_ID,
          description: parsed.error,
          duration: 6_000,
        });
        return;
      }
      toast.dismiss(ROLEPLAY_REVISION_TOAST_ID);
      setRevisionProposals(parsed.proposals);
      setRevisionReviewOpen(true);
    } catch (error) {
      toast.error("Could not work out what to change", {
        id: ROLEPLAY_REVISION_TOAST_ID,
        description: error instanceof Error ? error.message : undefined,
        duration: 6_000,
      });
    } finally {
      setRevisionBusy(false);
    }
  }, [handleRunGeneration, opencodeClient, revisionBusy, roleplaySurface, roleplayTurnsQuery.data, selectedSessionId]);

  const handleApplyRevision = useCallback(async (approved: RevisableField[]) => {
    const character = roleplayBindingQuery.data?.character;
    if (!character) return;
    setRevisionBusy(true);
    try {
      const applied = applyRevision({
        character,
        proposals: revisionProposals,
        approved,
        revisionId: createRevisionId(Date.now(), Math.random().toString(36).slice(2, 8)),
        now: Date.now(),
      });
      if (!applied.ok) {
        toast.error("Could not apply the changes", { description: applied.message });
        return;
      }
      // Approving nothing leaves the card byte-identical and writes no history.
      if (applied.unchanged) {
        setRevisionReviewOpen(false);
        setRevisionProposals([]);
        return;
      }
      await applyRoleplayRevision.mutateAsync({ revision: applied.revision, character: applied.character });
      await roleplayBindingQuery.refetch();
      toast.success(`Updated ${applied.changedFields.join(", ")}`, {
        description: "The previous card is kept, so this can be undone.",
      });
      setRevisionReviewOpen(false);
      setRevisionProposals([]);
    } catch (error) {
      toast.error("Could not apply the changes", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRevisionBusy(false);
    }
  }, [applyRoleplayRevision, revisionProposals, roleplayBindingQuery]);

  const handleSaveStorySoFar = useCallback(async (value: string) => {
    const binding = roleplayBindingQuery.data?.binding;
    if (!binding) return;
    await bindRoleplaySession.mutateAsync({ ...binding, storySoFar: value });
  }, [bindRoleplaySession, roleplayBindingQuery.data]);

  const handleChangeRoleplaySettings = useCallback(async (settings: RoleplaySessionSettings) => {
    const binding = roleplayBindingQuery.data?.binding;
    if (!binding) return;
    await bindRoleplaySession.mutateAsync({ ...binding, settings });
  }, [bindRoleplaySession, roleplayBindingQuery.data]);

  // Rebinding rather than a separate call: the persona is part of what makes a
  // session a roleplay session, and the binding is the only record of it.
  const handleSelectRoleplayPersona = useCallback(async (personaId: string) => {
    const binding = roleplayBindingQuery.data?.binding;
    if (!binding || binding.personaId === personaId) return;
    await bindRoleplaySession.mutateAsync({ ...binding, personaId });
  }, [bindRoleplaySession, roleplayBindingQuery.data]);

  // Latest session-list state for prev/next session tab navigation. The
  // `options` field is updated by `onSessionTabsChange` from SessionPage so we
  // only cycle through tabs the user actually opened (not artifact sessions).
  // The remaining fields are refreshed during render.
  const sessionTabNavRef = useRef<{
    options: OpenSessionTab[];
    workspaceId: string;
    sessionId: string | null;
    navigate: (workspaceId: string, sessionId?: string | null) => void;
  }>({ options: [], workspaceId: "", sessionId: null, navigate: () => {} });

  const goToSessionTabByOffset = useCallback((offset: number) => {
    const { options, workspaceId, sessionId, navigate } = sessionTabNavRef.current;
    const scoped = options.filter((option) => option.workspaceId === workspaceId);
    if (scoped.length === 0) return;
    const currentIndex = sessionId
      ? scoped.findIndex((option) => option.sessionId === sessionId)
      : -1;
    const nextIndex = currentIndex === -1
      ? offset > 0 ? 0 : scoped.length - 1
      : (currentIndex + offset + scoped.length) % scoped.length;
    const target = scoped[nextIndex];
    if (!target || target.sessionId === sessionId) return;
    navigate(target.workspaceId, target.sessionId);
  }, []);

  const goToNextSessionTab = useCallback(() => goToSessionTabByOffset(1), [goToSessionTabByOffset]);
  const goToPrevSessionTab = useCallback(() => goToSessionTabByOffset(-1), [goToSessionTabByOffset]);

  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    sessionSearchOpen,
    setSessionSearchOpen,
    terminalOpen,
    setTerminalOpen,
    sessionNumberShortcuts,
  } = useShellShortcuts({
    canCreateTask,
    workspaceId: selectedWorkspaceId,
    onCreateTask: (workspaceId: string) => void handleCreateTaskInWorkspace(workspaceId),
    onNextSessionTab: goToNextSessionTab,
    onPrevSessionTab: goToPrevSessionTab,
  });
  useReactRenderWatchdog("SessionRoute", {
    selectedSessionId,
    selectedWorkspaceId,
    loading,
    workspaceCount: workspaces.length,
    sessionGroupCount: Object.keys(sessionsByWorkspaceId).length,
    commandPaletteOpen,
    modelPickerOpen: modelPicker.open,
  });

  const navigateToSessionForControl = useCallback((sessionId: string) => {
    const owner = Object.entries(sessionsByWorkspaceId).find(([, sessions]) =>
      (sessions ?? []).some((session) => session?.id === sessionId),
    )?.[0];
    navigateToWorkspaceSession(owner || selectedWorkspaceId, sessionId);
  }, [navigateToWorkspaceSession, selectedWorkspaceId, sessionsByWorkspaceId]);

  const navigateToSessionRootForControl = useCallback(() => {
    navigateToWorkspaceSession(selectedWorkspaceId);
  }, [navigateToWorkspaceSession, selectedWorkspaceId]);

  const openModelPickerForControl = useCallback(() => {
    modelPicker.setOpen(true);
  }, []);

  useSessionControlActions({
    workspaces,
    sessionsByWorkspaceId,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedSessionId,
    canCreateTask,
    openworkClient: client,
    opencodeClient,
    navigateToSession: navigateToSessionForControl,
    navigateToSessionRoot: navigateToSessionRootForControl,
    createTaskInWorkspace: handleCreateTaskInWorkspace,
    openModelPicker: openModelPickerForControl,
    refreshRouteState,
  });

  const seedUnavailableModelControlAction = useMemo<OpenworkControlAction | null>(() => {
    if (!import.meta.env.DEV) return null;
    return {
      id: "eval.model_not_available.seed",
      label: "Seed an unavailable selected model",
      description: "Dev-only eval hook that selects a missing model and returns an available model to recover with.",
      sideEffect: "mutation",
      disabled: !opencodeClient,
      execute: async () => {
        if (!opencodeClient) return { ok: false, error: "OpenCode client is not connected." };

        const providerList = await ensureProviderListQuery(getReactQueryClient(), {
          client: opencodeClient,
          baseUrl: opencodeBaseUrl,
          directory: selectedWorkspaceRoot || undefined,
          force: true,
        });
        const filteredProviderList = filterProviderList(providerList, disabledProviderIds);
        const availableProvider = getConnectedProviderItems(filteredProviderList)
          .filter((provider) => !isDesktopProviderBlocked({
            providerId: provider.id,
            checkRestriction: checkDesktopRestriction,
          }))
          .find((provider) => Object.keys(provider.models ?? {}).length > 0);
        const availableModelId = availableProvider ? Object.keys(availableProvider.models ?? {})[0] : undefined;
        const availableModel = availableProvider && availableModelId
          ? availableProvider.models[availableModelId]
          : undefined;

        if (!availableProvider || !availableModelId || !availableModel) {
          return { ok: false, error: "No available connected model found for eval recovery." };
        }

        const unavailableModel = nextEvalUnavailableModel(local.prefs.defaultModel);
        modelPicker.setQuery("");
        modelPicker.setRecentProviderIds(new Set());
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: unavailableModel,
          modelVariant: null,
        }));

        return {
          unavailableModel,
          availableModel: {
            providerID: availableProvider.id,
            providerName: availableProvider.name || availableProvider.id,
            modelID: availableModelId,
            title: availableModel.name || availableModelId,
          },
          sessionId: selectedSessionId,
          workspaceId: selectedWorkspaceId,
        };
      },
    };
  }, [checkDesktopRestriction, disabledProviderIds, local, modelPicker.setQuery, modelPicker.setRecentProviderIds, opencodeBaseUrl, opencodeClient, selectedSessionId, selectedWorkspaceId, selectedWorkspaceRoot]);
  useControlAction(seedUnavailableModelControlAction);

  const seedActiveSessionSidebarControlAction = useMemo<OpenworkControlAction | null>(() => {
    if (!import.meta.env.DEV) return null;
    return {
      id: "eval.session_sidebar.seed_active",
      label: "Show the selected session as active",
      description: "Dev-only eval hook that displays the selected session activity spinner.",
      sideEffect: "mutation",
      disabled: !selectedWorkspaceId || !selectedSessionId,
      execute: () => {
        if (!selectedWorkspaceId || !selectedSessionId) {
          return { ok: false, error: "No session is selected." };
        }
        useSessionActivityStore.getState().setRunStatus(selectedWorkspaceId, selectedSessionId, "running");
        return { workspaceId: selectedWorkspaceId, sessionId: selectedSessionId };
      },
    };
  }, [selectedSessionId, selectedWorkspaceId]);
  useControlAction(seedActiveSessionSidebarControlAction);

  const commandPaletteControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "command_palette.open",
    label: "Open the command palette",
    description: "Open the in-app command palette so the next choice is visible.",
    effects: { data: "none", ui: "dialog", external: false },
    sideEffect: "none",
    execute: () => setCommandPaletteOpen(true),
  }), []);
  useControlAction(commandPaletteControlAction);

  const addProviderControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "settings.provider.add",
    label: "Add a model provider",
    description: "Open the provider connection modal, optionally pre-filtered to a specific provider.",
    sideEffect: "mutation",
    requiresArgs: false,
    args: [
      { name: "providerId", type: "string" as const, required: false, description: "Provider id to pre-select, e.g. 'anthropic', 'openai', 'google'." },
    ],
    execute: async (rawArgs: unknown) => {
      const providerId = typeof rawArgs === "object" && rawArgs !== null
        ? (rawArgs as Record<string, unknown>).providerId
        : undefined;
      const preferred = typeof providerId === "string" ? providerId.trim() : undefined;
      if (sessionProviderAuthStore.isProviderAddRestricted(preferred)) {
        return { ok: false, error: t("providers.custom_providers_disabled") };
      }
      await sessionProviderAuthStore.openProviderAuthModal(
        preferred ? { preferredProviderId: preferred } : undefined,
      );
      return { ok: true, opened: "provider_auth_modal", preferredProviderId: preferred ?? null };
    },
  }), [sessionProviderAuthStore]);
  useControlAction(addProviderControlAction);

  const handleOpenProviderAuth = useCallback(() => {
    if (sessionProviderAuthStore.isProviderAddRestricted()) {
      restrictionNotice.show({
        title: t("restrictions.add_custom_providers_disabled_title"),
        message: t("restrictions.add_custom_providers_disabled_message"),
      });
      return;
    }

    // Pre-workspace (chat-first) there is no opencode client yet, so the
    // modal cannot load auth methods — fall back to the AI Providers page.
    void sessionProviderAuthStore.openProviderAuthModal({ returnFocusTarget: "composer" }).catch(() => {
      handleOpenSettings("/settings/ai");
    });
  }, [handleOpenSettings, restrictionNotice, sessionProviderAuthStore]);

  // "Your API keys → Connect" in the compact model picker (and anything else
  // outside this route's prop tree) requests the provider auth modal here.
  useEffect(() => {
    const handler = () => handleOpenProviderAuth();
    window.addEventListener(openProviderAuthEvent, handler);
    return () => window.removeEventListener(openProviderAuthEvent, handler);
  }, [handleOpenProviderAuth]);

  const paletteSessionOptions = useMemo(
    () => buildCommandPaletteSessions(workspaces, sessionsByWorkspaceId, selectedWorkspaceId),
    [sessionsByWorkspaceId, selectedWorkspaceId, workspaces],
  );

  // Refresh the non-tab fields of the nav ref during render. The `options`
  // field is maintained by the `onSessionTabsChange` callback from SessionPage.
  sessionTabNavRef.current = {
    options: sessionTabNavRef.current.options,
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
    navigate: navigateToWorkspaceSession,
  };

  const paletteSessionGroups = useMemo<SessionGroupOption[]>(
    () => selectedWorkspaceGroupState?.groups ?? [],
    [selectedWorkspaceGroupState?.groups],
  );

  const currentSessionForGroupMove = useMemo(() => {
    if (!selectedWorkspaceId || !selectedSessionId) return null;
    return paletteSessionOptions.find(
      (session) => session.workspaceId === selectedWorkspaceId && session.sessionId === selectedSessionId,
    ) ?? null;
  }, [paletteSessionOptions, selectedSessionId, selectedWorkspaceId]);

  const currentSessionGroupId = selectedSessionId
    ? selectedWorkspaceGroupState?.assignments[selectedSessionId] ?? null
    : null;

  const handleMoveCurrentSessionToGroup = useCallback((groupId: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    assignSessionToGroup(selectedWorkspaceId, selectedSessionId, groupId);
  }, [assignSessionToGroup, selectedSessionId, selectedWorkspaceId]);

  const sessionSearchFetcher = useMemo<SessionMessageFetcher | null>(() => {
    if (!client) return null;
    // Cap the transcript fetch to keep multi-workspace scans fast; matches in
    // anything older than the most recent 400 messages are traded away for
    // responsiveness.
    return async (workspaceId: string, sessionId: string) =>
      (await client.getSessionMessages(workspaceId, sessionId, { limit: 400 })).items;
  }, [client]);

  const sessionSearchPaletteItem = useMemo<PaletteItem>(() => ({
    id: "session-search.open",
    title: "Search session messages",
    detail: "Deep search every session, including message content",
    meta: "Cmd/Ctrl+Shift+F",
    searchText: "search find sessions messages history transcript content",
    action: () => {
      setCommandPaletteOpen(false);
      setSessionSearchOpen(true);
    },
  }), []);

  const sessionFindPaletteItem = useMemo<PaletteItem | null>(() => {
    if (!selectedSessionId) return null;
    return {
      id: "session-find.open",
      title: "Find in conversation",
      detail: "Search within the current conversation",
      meta: "Cmd/Ctrl+F",
      searchText: "find search current conversation session messages transcript",
      action: () => {
        setCommandPaletteOpen(false);
        useSessionFindStore.getState().openFind({ sessionId: selectedSessionId });
      },
    };
  }, [selectedSessionId]);

  const terminalPaletteItems = useMemo<PaletteItem[]>(() => platform.capabilities.terminal ? [
    {
      id: "terminal.toggle",
      title: terminalOpen ? "Hide terminal" : "Show terminal",
      detail: "Toggle the integrated terminal panel for this workspace",
      meta: "Cmd/Ctrl+J",
      searchText: "terminal shell command line console show hide toggle",
      action: () => {
        setCommandPaletteOpen(false);
        setTerminalOpen((value) => !value);
      },
    },
  ] : [], [platform.capabilities.terminal, terminalOpen]);

  const developerModePaletteItem = useMemo<PaletteItem>(() => ({
    id: "developer-mode.toggle",
    title: developerMode ? t("settings.disable_developer_mode") : t("settings.enable_developer_mode"),
    detail: t("settings.developer_mode_desc"),
    meta: developerMode ? "On" : "Off",
    searchText: "developer dev mode debug diagnostics toggle enable disable",
    action: () => {
      setCommandPaletteOpen(false);
      setDeveloperMode((current) => {
        const next = !current;
        try { window.localStorage.setItem("openwork.developerMode", next ? "1" : "0"); } catch {}
        return next;
      });
    },
  }), [developerMode]);

  const buildCommandDiagnosticsBundle = useCallback(() => buildDiagnosticsBundleJson({
    anyActiveRuns: activeReloadBlockingSessions.length > 0,
    canReloadWorkspace: reloadCoordinator.canReloadWorkspaceEngine,
    clientConnected: canCreateTask,
    developerMode,
    hostInfo: openworkServerHostInfoState,
    openworkServerStatus: client ? "connected" : "disconnected",
    openworkServerUrl: baseUrl,
    runtimeWorkspaceId: selectedWorkspaceEndpoint?.workspaceId ?? null,
  }), [
    activeReloadBlockingSessions.length,
    baseUrl,
    canCreateTask,
    client,
    developerMode,
    openworkServerHostInfoState,
    reloadCoordinator.canReloadWorkspaceEngine,
    selectedWorkspaceEndpoint?.workspaceId,
  ]);

  const diagnosticsCopyPaletteItem = useMemo<PaletteItem>(() => ({
    id: "diagnostics.copy",
    title: t("session.cmd_diagnostics_copy_title"),
    detail: t("session.cmd_diagnostics_copy_detail"),
    searchText: "logs share diagnostics debug support bundle troubleshoot copy report issue",
    action: async () => {
      setCommandPaletteOpen(false);
      try {
        const json = await buildCommandDiagnosticsBundle();
        await navigator.clipboard.writeText(json);
        toast.success(t("session.diagnostics_copied"));
      } catch (error) {
        toast.error(t("session.diagnostics_failed"), { description: describeRouteError(error) });
      }
    },
  }), [buildCommandDiagnosticsBundle]);

  const diagnosticsExportPaletteItem = useMemo<PaletteItem>(() => ({
    id: "diagnostics.export",
    title: t("session.cmd_diagnostics_export_title"),
    detail: t("session.cmd_diagnostics_export_detail"),
    searchText: "logs export diagnostics debug support bundle save file json download",
    action: async () => {
      setCommandPaletteOpen(false);
      try {
        const json = await buildCommandDiagnosticsBundle();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        downloadTextAsFile(`openwork-diagnostics-${timestamp}.json`, json, "application/json");
        toast.success(t("session.diagnostics_exported"));
      } catch (error) {
        toast.error(t("session.diagnostics_failed"), { description: describeRouteError(error) });
      }
    },
  }), [buildCommandDiagnosticsBundle]);

  const nextSessionTabPaletteItem = useMemo<PaletteItem>(() => ({
    id: "session-tab.next",
    title: "Next session tab",
    detail: "Switch to the next session in this workspace",
    meta: "Cmd/Ctrl+T",
    searchText: "next session tab switch forward",
    action: () => {
      setCommandPaletteOpen(false);
      goToNextSessionTab();
    },
  }), [goToNextSessionTab]);

  const prevSessionTabPaletteItem = useMemo<PaletteItem>(() => ({
    id: "session-tab.previous",
    title: "Previous session tab",
    detail: "Switch to the previous session in this workspace",
    meta: "Cmd/Ctrl+Shift+T",
    searchText: "previous session tab switch back",
    action: () => {
      setCommandPaletteOpen(false);
      goToPrevSessionTab();
    },
  }), [goToPrevSessionTab]);

  const reloadConfigPaletteItem = useMemo<PaletteItem>(() => ({
    id: "reload-opencode-config",
    title: t("session.cmd_reload_config_title"),
    detail: t("session.cmd_reload_config_detail"),
    meta: reloadCoordinator.canReloadWorkspaceEngine
      ? t("config.reload_engine")
      : t("system.reload_unavailable"),
    searchText: "reload opencode config providers models mcp jsonc refresh re-read engine restart",
    action: () => {
      setCommandPaletteOpen(false);
      if (!reloadCoordinator.canReloadWorkspaceEngine) return;
      void reloadCoordinator.reloadWorkspaceEngine();
    },
  }), [reloadCoordinator.canReloadWorkspaceEngine, reloadCoordinator.reloadWorkspaceEngine]);

  const handleReorderWorkspaces = useCallback((workspaceIds: string[]) => {
    const activeWorkspaceIds = new Set(workspacesRef.current.map((workspace) => workspace.id));
    const nextOrderIds: string[] = [];
    const nextOrderIdSet = new Set<string>();

    for (const id of workspaceIds) {
      if (!activeWorkspaceIds.has(id) || nextOrderIdSet.has(id)) continue;
      nextOrderIds.push(id);
      nextOrderIdSet.add(id);
    }

    for (const workspace of workspacesRef.current) {
      if (nextOrderIdSet.has(workspace.id)) continue;
      nextOrderIds.push(workspace.id);
      nextOrderIdSet.add(workspace.id);
    }

    workspaceOrderIdsRef.current = nextOrderIds;
    setWorkspaceOrderIds(nextOrderIds);
    writeWorkspaceOrderIds(nextOrderIds);
    setWorkspaces((current) => orderRouteWorkspaces(current, nextOrderIds));
  }, []);

  const handleArchiveSession = useCallback(
    async (sessionId: string, archived: boolean) => {
      if (!opencodeClient) return;
      try {
        await setSessionArchived(
          opencodeClient,
          sessionId,
          archived,
          selectedWorkspaceRoot || undefined,
        );
        await refreshRouteState();
      } catch (error) {
        console.error("[session-route] archive session failed", error);
        toast.error(
          archived
            ? t("session_management.archive_failed")
            : t("session_management.unarchive_failed"),
          { description: describeRouteError(error) },
        );
      }
    },
    [opencodeClient, refreshRouteState, selectedWorkspaceRoot],
  );

  const handleCreateWorkspace = useCallback(async (
    preset: WorkspacePreset,
    folder: string | null,
    options?: CreateWorkspaceOptions,
  ) => {
    if (!folder) return;
    const projectLabel = options?.projectLabel?.trim() ?? "";
    setCreateWorkspaceBusy(true);
    setCreateWorkspaceError(null);
    try {
      const workspaceName = folderNameFromPath(folder);
      let list: WorkspaceList | null = null;
      let createdOnServer = false;
      if (client) {
        list = await client
          .createLocalWorkspace({ folderPath: folder, name: workspaceName, preset })
          .then((serverList) => {
            createdOnServer = true;
            return serverList;
          })
          .catch(() => null);
      }
      if (!list) {
        throw new Error("OpenWork server is unavailable. Start or reconnect the server before creating a workspace.");
      }
      const createdId = resolveWorkspaceListSelectedId(list) || list.workspaces[list.workspaces.length - 1]?.id || "";
      let targetWorkspaceId = createdId;
      let targetWorkspace = list.workspaces.find((workspace: WorkspaceInfo) => workspace.id === createdId) ?? null;
      if (createdId) {
        await workspaceSetSelected(createdId).catch(() => undefined);
        await workspaceSetRuntimeActive(createdId).catch(() => undefined);
      }
      // First workspace on a fresh install: the OpenWork server was started
      // engine-less (it only spawns OpenCode at boot when a workspace already
      // exists), so sessions would hang forever. This boots the engine when
      // it isn't running, same as the old /welcome flow did.
      let sessionBaseUrl = baseUrl;
      let sessionToken = token;
      if (targetWorkspace && isDesktopRuntime()) {
        await ensureDesktopLocalOpenworkConnection({
          route: "session",
          workspace: targetWorkspace,
          allWorkspaces: list.workspaces,
        }).catch(() => undefined);
        // The engine boot can restart the server with fresh tokens; re-resolve
        // so the first-session creation below doesn't use stale credentials.
        const fresh = await resolveOpenworkConnection().catch(() => null);
        if (fresh?.normalizedBaseUrl && fresh.resolvedToken) {
          sessionBaseUrl = fresh.normalizedBaseUrl;
          sessionToken = fresh.resolvedToken;
        }
      }
      setCreateWorkspaceOpen(false);
      // Mark onboarding complete so the /welcome redirect never fires again.
      local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: true }));
      await refreshRouteState();
      if (targetWorkspaceId) {
        const workspacePath = targetWorkspace?.path?.trim() || folder;
        // Best-effort first task creation (mirrors the old welcome flow) — a
        // failure here must not surface as a failed workspace creation.
        const session = createdOnServer && sessionBaseUrl && sessionToken
          ? await createClient(
              `${(buildOpenworkWorkspaceBaseUrl(sessionBaseUrl, targetWorkspaceId) ?? sessionBaseUrl).replace(/\/+$/, "")}/opencode`,
              workspacePath || undefined,
              { token: sessionToken, mode: "openwork" },
            ).session.create({ directory: workspacePath || undefined })
              .then((result) => unwrap(result))
              .catch(() => null)
          : null;
        setLegacySelectedWorkspaceId(targetWorkspaceId);
        writeActiveWorkspaceId(targetWorkspaceId);
        if (projectLabel) {
          writeWorkspaceProjectDimension(targetWorkspaceId, {
            label: projectLabel,
          });
        }
        captureAnalyticsEvent("workspace_created", { workspace_type: "local" });
        if (session?.id) {
          captureAnalyticsEvent("task_created", { source: "workspace_created", workspace_type: "local" });
          const firstTaskPrompt = options?.firstTaskPrompt?.trim();
          if (firstTaskPrompt) {
            const firstTaskAttachments = options?.firstTaskAttachments ?? [];
            // Attachment chips only survive in-memory (File objects), so the
            // persisted fallback draft drops their tokens.
            saveSessionDraft(targetWorkspaceId, session.id, { text: firstTaskPrompt.replace(/\[attachment [^\]]+\]/g, "").trim(), mode: "prompt" });
            // The composer reads its draft from the composer state store, not
            // the persisted draft store — seed both so the prompt shows up.
            useComposerStateStore.getState().setDraft(session.id, firstTaskPrompt);
            if (firstTaskAttachments.length) {
              useComposerStateStore.getState().setAttachments(session.id, firstTaskAttachments);
            }
            // One-step run: the session surface sends the seeded draft itself.
            markComposerAutoSend(session.id);
          }
          writeLastSessionFor(targetWorkspaceId, session.id);
          rememberPendingCreatedSession(targetWorkspaceId, session.id);
          setSessionsByWorkspaceId((current) => {
            const next = {
              ...current,
              [targetWorkspaceId]: [session, ...(current[targetWorkspaceId] ?? [])],
            };
            sessionsByWorkspaceIdRef.current = next;
            return next;
          });
        }
        navigateToWorkspaceSession(targetWorkspaceId, session?.id ?? null, { replace: true });
        if (session?.id) focusPromptSoon();
      }
    } catch (error) {
      setCreateWorkspaceError(describeWorkspaceCreateError(error));
    } finally {
      setCreateWorkspaceBusy(false);
    }
  }, [baseUrl, client, local, navigateToWorkspaceSession, refreshRouteState, rememberPendingCreatedSession, token]);

  /**
   * Chat-first onboarding: the empty-state composer creates a default chat
   * workspace under the user's home folder instead of asking where to put
   * it. Falls back to the create-workspace modal off desktop.
   */
  const handleChatFirstTask = useCallback((prompt: string, attachments?: ComposerAttachment[]) => {
    void (async () => {
      if (!isDesktopRuntime()) {
        // The cloud workspace is provisioned by Den; boot takeover covers the pre-attach state.
        if (!canCreateWorkspaces()) return;
        handleOpenCreateWorkspace();
        return;
      }
      const home = await getDesktopHomeDir().catch(() => "");
      if (!home) {
        handleOpenCreateWorkspace();
        return;
      }
      const folder = await joinDesktopPath(home, "OpenWork Chat").catch(() => "");
      if (!folder) {
        handleOpenCreateWorkspace();
        return;
      }
      await handleCreateWorkspace("starter", folder, { firstTaskPrompt: prompt, firstTaskAttachments: attachments ?? [] });
    })();
  }, [handleCreateWorkspace, handleOpenCreateWorkspace]);

  const createWorkspaceControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "workspace.create",
    label: "Create a local workspace",
    description: "Create a workspace at the given folder path without showing the file picker dialog, optionally labeling its project for analytics.",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "path", type: "string", required: true, description: "Absolute folder path for the new workspace." },
      { name: "projectLabel", type: "string", required: false, description: "Optional project name used to group the workspace's sessions in analytics." },
    ],
    execute: async (args) => {
      if (!canCreateWorkspaces()) return { ok: false, error: "workspace creation is unavailable" };
      const parsed = args as { path?: string; projectLabel?: string } | undefined;
      const folder = parsed?.path?.trim();
      if (!folder) return { ok: false, error: "path is required" };
      const trimmedLabel = parsed?.projectLabel?.trim() ?? "";
      await handleCreateWorkspace("starter", folder, trimmedLabel ? { projectLabel: trimmedLabel } : undefined);
      return { path: folder };
    },
  }), [handleCreateWorkspace]);
  useControlAction(createWorkspaceControlAction);

  const handleCreateRemoteWorkspace = useCallback(async (input: {
    openworkHostUrl?: string | null;
    openworkToken?: string | null;
    directory?: string | null;
    displayName?: string | null;
  }) => {
    const baseUrlValue = input.openworkHostUrl?.trim() ?? "";
    if (!baseUrlValue) return false;
    setCreateWorkspaceRemoteBusy(true);
    setCreateWorkspaceRemoteError(null);
    try {
      const remoteType: "openwork" = "openwork";
      const payload = {
        baseUrl: baseUrlValue,
        openworkHostUrl: baseUrlValue,
        openworkToken: input.openworkToken?.trim() || null,
        displayName: input.displayName?.trim() || null,
        directory: input.directory?.trim() || null,
        remoteType,
      };
      let list: WorkspaceList | null = null;
      if (isDesktopRuntime()) {
        list = await workspaceCreateRemote(payload);
      } else if (client) {
        list = await client.createRemoteWorkspace(payload).catch(() => null);
      }
      if (!list) {
        throw new Error("OpenWork server is unavailable. Start or reconnect the server before connecting a remote workspace.");
      }
      const createdId = resolveWorkspaceListSelectedId(list) || list.workspaces[list.workspaces.length - 1]?.id || "";
      if (createdId) {
        await workspaceSetSelected(createdId).catch(() => undefined);
        await workspaceSetRuntimeActive(createdId).catch(() => undefined);
      }
      setCreateWorkspaceOpen(false);
      // Mark onboarding complete so the /welcome redirect never fires again.
      local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: true }));
      await refreshRouteState();
      return true;
    } catch (error) {
      setCreateWorkspaceRemoteError(error instanceof Error ? error.message : t("app.unknown_error"));
      return false;
    } finally {
      setCreateWorkspaceRemoteBusy(false);
    }
  }, [client, local, refreshRouteState]);

  return (
    <WorkspaceProvider
      client={opencodeClient}
      opencodeBaseUrl={opencodeBaseUrl}
      openworkServerClient={selectedWorkspaceEndpoint?.client ?? null}
      workspaceId={selectedWorkspaceEndpoint?.workspaceId ?? ""}
      selectedWorkspaceRoot={selectedWorkspaceRoot}
    >
    {opencodeClient && selectedWorkspaceEndpoint && opencodeBaseUrl && selectedWorkspaceServerToken ? (
      <ReactSessionRuntime
        // Use the server-side workspace id (the one without the `rem_`
        // prefix) so the React Query cache keys session-sync writes match
        // the keys SessionSurface reads from. Otherwise events arrive but
        // the UI never sees them and gets stuck on "thinking".
        workspaceId={selectedWorkspaceEndpoint.workspaceId}
        sessionId={selectedSessionId}
        activeSessionIds={activeSelectedWorkspaceSessionIds}
        opencodeBaseUrl={opencodeBaseUrl}
        openworkToken={selectedWorkspaceServerToken}
        onSessionCreated={handleRuntimeSessionCreated}
        onSessionUpdated={handleRuntimeSessionUpdated}
        onSessionDeleted={handleRuntimeSessionDeleted}
      />
    ) : null}
    <SessionPage
      sessionNumberShortcuts={sessionNumberShortcuts}
      selectedSessionId={selectedSessionId}
      selectedWorkspaceId={selectedWorkspaceId}
      selectedWorkspaceDisplay={selectedWorkspace ? {
        id: selectedWorkspace.id,
        name: selectedWorkspace.name ?? undefined,
        displayName: selectedWorkspace.displayNameResolved,
        workspaceType: selectedWorkspace.workspaceType,
      } : { workspaceType: "local" }}
      selectedWorkspaceRoot={selectedWorkspaceRoot}
      selectedWorkspaceError={selectedWorkspaceError}
      runtimeWorkspaceId={selectedWorkspaceEndpoint?.workspaceId || null}
      opencodeBaseUrl={opencodeBaseUrl}
      workspaces={workspaces}
      clientConnected={canCreateTask}
      openworkServerStatus={client ? "connected" : "disconnected"}
      openworkServerClient={selectedWorkspaceEndpoint?.client ?? client}
      environmentClient={client}
      openworkServerToken={selectedWorkspaceServerToken}
      developerMode={developerMode}
      headerStatus={canCreateTask ? t("status.connected") : (modelUnavailableMessage ?? t("session.loading_detail"))}
      busyHint={organizationModelsEmpty ? t("models.organization_models_empty") : effectiveLoading ? t("session.loading_detail") : null}
      startupPhase={effectiveLoading ? "nativeInit" : "ready"}
      providerConnectedIds={providerConnectedIds}
      hasUsableModel={hasUsableModel}
      providers={providers}
      mcpConnectedCount={mcpConnectedCount}
      onSendFeedback={() => {
        platform.openLink(
          buildFeedbackUrl({
            entrypoint: "status-bar",
          }),
        );
      }}
      onOpenSettings={() => handleOpenSettings("/settings/general")}
      onOpenExtensions={() => handleOpenExtensions()}
      onOpenProviderAuth={handleOpenProviderAuth}
      onChatFirstTask={handleChatFirstTask}
      chatFirstBusy={createWorkspaceBusy}
      newTaskComposer={newTaskComposerContext}
      providerAuthModal={sessionProviderAuthSnapshot.providerAuthModalOpen ? {
        open: true,
        loading: false,
        submitting: sessionProviderAuthSnapshot.providerAuthBusy,
        error: sessionProviderAuthSnapshot.providerAuthError,
        preferredProviderId: sessionProviderAuthSnapshot.providerAuthPreferredProviderId,
        workerType: sessionProviderAuthSnapshot.providerAuthWorkerType,
        providers: sessionProviderAuthSnapshot.providerAuthProviders.filter(
          (provider) => !isDesktopProviderBlocked({ providerId: provider.id, checkRestriction: checkDesktopRestriction }),
        ),
        connectedProviderIds: providerConnectedIds,
        authMethods: Object.fromEntries(
          Object.entries(sessionProviderAuthSnapshot.providerAuthMethods).filter(
            ([providerId]) => !isDesktopProviderBlocked({ providerId, checkRestriction: checkDesktopRestriction }),
          ),
        ),
        onSelect: sessionProviderAuthStore.startProviderAuth,
        onSubmitApiKey: async (providerId, apiKey) => {
          const result = await sessionProviderAuthStore.submitProviderApiKey(providerId, apiKey);
          modelPicker.setRecentProviderIds(new Set([providerId]));
          modelPicker.setQuery("");
          modelPicker.setOpen(true);
          return result;
        },
        onSubmitOAuth: sessionProviderAuthStore.completeProviderAuthOAuth,
        onRefreshProviders: sessionProviderAuthStore.refreshProviders,
        onClose: () => sessionProviderAuthStore.closeProviderAuthModal(),
      } : null}
      settingsSlot={
        <SettingsSurface
          embedded
          initialPath="extensions"
          workspaceId={selectedWorkspaceId}
          onClose={() => {
            try {
              window.dispatchEvent(new CustomEvent("openwork-close-right-pane"));
            } catch {
              // ignore
            }
          }}
        />
      }
      primaryTitle={automationsRouteActive ? "Automations" : roleplayRouteActive ? "Characters" : undefined}
      primarySlot={automationsRouteActive ? (
        <AutomationsPage providerCatalog={providerCatalog} />
      ) : roleplayRouteActive ? (
        <RoleplayPage
          endpoint={selectedWorkspaceEndpoint ?? null}
          onStartChat={handleStartRoleplayChat}
          onRunGeneration={opencodeClient ? handleRunGeneration : undefined}
        />
      ) : undefined}
      terminalOpen={terminalOpen}
      onTerminalOpenChange={setTerminalOpen}
      onSessionTabsChange={(tabs) => {
        sessionTabNavRef.current = { ...sessionTabNavRef.current, options: tabs };
      }}
      sidebar={{
        workspaceSessionGroups,
        selectedWorkspaceId,
        selectedSessionId,
        developerMode: false,
        sessionStatusById: sidebarSessionStatusById,
        connectingWorkspaceId: null,
        workspaceConnectionStateById,
        newTaskDisabled: !canCreateTask,
        sidebarHydratedFromCache: Object.values(sessionsByWorkspaceId).some((list) => list.length > 0),
        startupPhase: effectiveLoading ? "nativeInit" : "ready",
        automationsActive: automationsRouteActive,
        automationsNeedAttention,
        onOpenAutomations: automationsNavigationAvailable
          ? () => {
              navigate(automationsRoute());
            }
          : undefined,
        roleplayActive: roleplayRouteActive,
        onOpenRoleplay: () => {
          navigate("/roleplay");
        },
        onSelectWorkspace: async (workspaceId) => {
          if (workspaceId === selectedWorkspaceId) return true;
          setLegacySelectedWorkspaceId(workspaceId);
          writeActiveWorkspaceId(workspaceId || null);
          const workspace = workspaces.find((item) => item.id === workspaceId);
          if (client && workspace && !sessionsByWorkspaceId[workspaceId]?.length) {
            setRetryingWorkspaceIds((current) => Array.from(new Set([...current, workspaceId])));
            void loadWorkspaceSessionsInBackground([workspace]);
          }
          // Fire Tauri updates but don't await them — they're bookkeeping and
          // awaiting 2 IPC roundtrips on every click used to stall rapid
          // workspace switches behind a queue.
          if (isDesktopRuntime()) {
            void workspaceSetSelected(workspaceId).catch(() => undefined);
            void workspaceSetRuntimeActive(workspaceId).catch(() => undefined);
          }
          // Tell the OpenWork server this workspace is now active so it can
          // emit a config reload event that the OpenCode engine picks up.
          // Without this, the permissions from opencode.jsonc are never
          // applied on the workspace the user is already on at launch. See
          // issue #870.
          if (workspaceId) {
            const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
            const endpoint = endpointForWorkspace(workspace);
            if (endpoint) {
              void endpoint.client.activateWorkspace(endpoint.workspaceId, { persist: true }).catch(() => undefined);
            }
          }
          // If we remember what the user last opened here and that session
          // still exists in our local list, navigate. Otherwise stay put.
          const remembered = readLastSessionFor(workspaceId);
          if (remembered && remembered !== selectedSessionId) {
            const known = sessionsByWorkspaceId[workspaceId];
            if (known?.some((session) => session?.id === remembered)) {
              navigateToWorkspaceSession(workspaceId, remembered);
            } else {
              navigateToWorkspaceSession(workspaceId);
            }
          } else {
            navigateToWorkspaceSession(workspaceId);
          }
          return true;
        },
        onOpenSession: (workspaceId, sessionId) => {
          setLegacySelectedWorkspaceId(workspaceId);
          writeActiveWorkspaceId(workspaceId || null);
          writeLastSessionFor(workspaceId, sessionId);
          navigateToWorkspaceSession(workspaceId, sessionId);
        },
        onPrefetchSession: () => {},
        onCreateTaskInWorkspace: (workspaceId, groupId) => {
          void handleCreateTaskInWorkspace(workspaceId).then((sessionId) => {
            if (sessionId && groupId) {
              sessionManagementStore.getState().assignGroup(workspaceId, sessionId, groupId);
            }
          });
        },
        onCreateTaskWithPrompt: (workspaceId, prompt, attachments) => {
          void (async () => {
            const workspace = workspaces.find((item) => item.id === workspaceId);
            if (!workspace) return;
            const endpoint = endpointForWorkspace(workspace);
            if (!endpoint?.token) return;
            const workspaceClient = createClient(
              endpoint.opencodeBaseUrl,
              workspace.path?.trim() || undefined,
              { token: endpoint.token, mode: "openwork" },
            );
            try {
              const session = unwrap(
                await workspaceClient.session.create({ directory: workspace.path?.trim() || undefined }),
              );
              if (workspaceId === selectedWorkspaceId) {
                void refreshCloudProviderSync("new_chat");
              }
              const firstTaskPrompt = prompt.trim();
              if (firstTaskPrompt) {
                const firstTaskAttachments = attachments ?? [];
                // Attachment chips only survive in-memory (File objects), so the
                // persisted fallback draft drops their tokens.
                saveSessionDraft(workspaceId, session.id, { text: firstTaskPrompt.replace(/\[attachment [^\]]+\]/g, "").trim(), mode: "prompt" });
                // The composer reads its draft from the composer state store,
                // not the persisted draft store — seed both.
                useComposerStateStore.getState().setDraft(session.id, firstTaskPrompt);
                if (firstTaskAttachments.length) {
                  useComposerStateStore.getState().setAttachments(session.id, firstTaskAttachments);
                }
                // One-step run: the session surface sends the seeded draft itself.
                markComposerAutoSend(session.id);
              }
              writeActiveWorkspaceId(workspaceId || null);
              writeLastSessionFor(workspaceId, session.id);
              rememberPendingCreatedSession(workspaceId, session.id);
              setSessionsByWorkspaceId((current) => ({
                ...current,
                [workspaceId]: [session, ...(current[workspaceId] ?? [])],
              }));
              navigateToWorkspaceSession(workspaceId, session.id);
              focusPromptSoon();
            } catch {
              // Fall back to normal task creation without prompt
              void handleCreateTaskInWorkspace(workspaceId);
            }
          })();
        },
        onOpenRenameWorkspace: handleOpenRenameWorkspace,
        onShareWorkspace: handleShareWorkspace,
        onRevealWorkspace: (id) => void handleRevealWorkspace(id),
        onRecoverWorkspace: (workspaceId) => runRemoteWorkspaceConnectionCheck(workspaceId, "recover"),
        onTestWorkspaceConnection: (workspaceId) => runRemoteWorkspaceConnectionCheck(workspaceId, "test"),
        onEditWorkspaceConnection: remoteWorkspaceConnectionEditor.open,
        onForgetWorkspace: (id) => void handleForgetWorkspace(id),
        onOpenCreateWorkspace: handleOpenCreateWorkspace,
        onOpenSessionSearch: () => setSessionSearchOpen(true),
        onReorderWorkspaces: handleReorderWorkspaces,
      }}
      surface={surfaceProps}
      history={{
        canUndo: false,
        canRedo: false,
        busyAction: null,
        onUndo: () => {},
        onRedo: () => {},
      }}
      todos={todos}
      sessionLoadingById={(sessionId) => effectiveLoading && Boolean(sessionId && sessionId === selectedSessionId)}
      shareWorkspaceModal={
        shareWorkspaceState.shareWorkspaceOpen
          ? {
              open: true,
              onClose: shareWorkspaceState.closeShareWorkspace,
              workspaceName: shareWorkspaceState.shareWorkspaceName,
              workspaceDetail: shareWorkspaceState.shareWorkspaceDetail,
              fields: shareWorkspaceState.shareFields,
              remoteAccess:
                isDesktopRuntime() && shareWorkspaceState.shareWorkspace?.workspaceType === "local"
                  ? {
                      enabled: openworkServerSettings.remoteAccessEnabled === true,
                      busy: remoteAccessRestart.busy,
                      error: remoteAccessRestart.error,
                      status: remoteAccessRestart.status,
                      onSave: handleSaveShareRemoteAccess,
                    }
                  : undefined,
              note: shareWorkspaceState.shareNote,
              onExportConfig:
                shareWorkspaceState.exportDisabledReason === null
                  ? () => {
                      const id = shareWorkspaceState.shareWorkspaceId;
                      if (!id) return;
                      void handleExportWorkspaceConfig(id);
                    }
                  : undefined,
              exportDisabledReason: shareWorkspaceState.exportDisabledReason,
            }
          : null
      }
      activePermission={activePermission}
      permissionReplyBusy={permissionReplyBusy}
      respondPermission={respondPermission}
      activeQuestion={activeQuestion}
      questionReplyBusy={questionReplyBusy}
      respondQuestion={respondQuestion}
      safeStringify={safeStringify}
      onRenameSession={
        opencodeClient
          ? async (sessionId, nextTitle) => {
              const trimmed = nextTitle.trim();
              if (!trimmed) return;
              await opencodeClient.session.update({
                sessionID: sessionId,
                title: trimmed,
                directory: selectedWorkspaceRoot || undefined,
              });
              await refreshRouteState();
            }
          : undefined
      }
      onDeleteSession={
        client && selectedWorkspaceId
          ? async (sessionId) => {
              const endpoint = endpointForWorkspace(selectedWorkspace);
              if (!endpoint) return;
              await endpoint.client.deleteSession(endpoint.workspaceId, sessionId);
              if (selectedSessionId === sessionId) {
                navigateToWorkspaceSession(selectedWorkspaceId);
              }
              await refreshRouteState();
            }
          : undefined
      }
      onArchiveSession={opencodeClient ? handleArchiveSession : undefined}
      statusBar={{
        loading: showPreparingStatus,
        reloadBusy: reloadCoordinator.reloadBusy,
        reloadError: reloadCoordinator.reloadError,
        openWorkConnectState: sessionMcpMaintenance,
      }}
      notFoundMessage={gatedRouteNotFoundMessage}
      mainContentTakeover={
        extensionsMainOpen ? (
          <SettingsSurface
            standaloneExtensions
            workspaceId={selectedWorkspaceId || undefined}
          />
        ) : cloudWorkspaceMainContentTakeover
      }
      mainContentTitle={extensionsMainOpen ? t("settings.tab_extensions") : undefined}
      extensionsActive={extensionsMainOpen}
      onAccessibleTargetsChange={setPaletteAccessibleTargets}
    />
    <CreateWorkspaceModal
      open={createWorkspaceOpen}
      onClose={() => {
        setCreateWorkspaceOpen(false);
        setCreateWorkspaceError(null);
      }}
      onConfirm={handleCreateWorkspace}
      onConfirmRemote={handleCreateRemoteWorkspace}
      onPickFolder={async () => singlePickedDirectory(await pickDirectory({ title: t("onboarding.authorize_folder") }))}
      submitting={createWorkspaceBusy}
      localError={createWorkspaceError}
      localDisabled={!platform.capabilities.nativeFilePicker}
      localDisabledReason={
        platform.capabilities.nativeFilePicker
          ? undefined
          : t("app.local_disabled_reason")
      }
      remoteSubmitting={createWorkspaceRemoteBusy}
      remoteError={createWorkspaceRemoteError}
    />
    <CreateRemoteWorkspaceModal
      open={remoteWorkspaceConnectionEditor.workspace !== null}
      onClose={remoteWorkspaceConnectionEditor.close}
      onConfirm={(input) => void remoteWorkspaceConnectionEditor.save(input)}
      initialValues={remoteWorkspaceConnectionEditor.initialValues}
      submitting={remoteWorkspaceConnectionEditor.busy}
      error={remoteWorkspaceConnectionEditor.error}
      title={t("dashboard.edit_remote_workspace_title")}
      subtitle={t("dashboard.edit_remote_workspace_subtitle")}
      confirmLabel={t("dashboard.edit_remote_workspace_confirm")}
    />
    <RenameWorkspaceModal
      open={renameWorkspaceId !== null}
      title={renameWorkspaceTitle}
      busy={renameWorkspaceBusy}
      canSave={!renameWorkspaceBusy && renameWorkspaceTitle.trim().length > 0}
      onClose={() => {
        if (renameWorkspaceBusy) return;
        setRenameWorkspaceId(null);
        setRenameWorkspaceTitle("");
      }}
      onSave={() => void handleSaveRenameWorkspace()}
      onTitleChange={setRenameWorkspaceTitle}
    />
    <CommandPalette
      open={commandPaletteOpen}
      onClose={() => setCommandPaletteOpen(false)}
      onCreateNewSession={() => {
        if (selectedWorkspaceId) {
          void handleCreateTaskInWorkspace(selectedWorkspaceId);
        }
      }}
      onOpenSession={(workspaceId, sessionId) => navigateToWorkspaceSession(workspaceId, sessionId)}
      onOpenSettings={(route) => handleOpenSettings(route ?? "/settings/general")}
      onOpenExtensions={() => handleOpenExtensions()}
      onOpenModelPicker={() => {
        modelPicker.setQuery("");
        modelPicker.setRecentProviderIds(new Set());
        window.requestAnimationFrame(() => modelPicker.setOpen(true));
      }}
      selectedModelLabel={modelLabel}
      accessibleTargets={paletteAccessibleTargets}
      onOpenAccessibleTarget={(target) => {
        try {
          window.dispatchEvent(new CustomEvent("openwork-open-accessible-target", { detail: target }));
        } catch {
          // ignore event dispatch failures
        }
      }}
      onHideAccessibleTarget={(target) => {
        try {
          window.dispatchEvent(new CustomEvent("openwork-hide-accessible-target", { detail: target }));
        } catch {
          // ignore event dispatch failures
        }
      }}
      sessions={paletteSessionOptions}
      sessionGroups={paletteSessionGroups}
      currentSessionForGroupMove={currentSessionForGroupMove}
      currentSessionGroupId={currentSessionGroupId}
      onMoveCurrentSessionToGroup={handleMoveCurrentSessionToGroup}
      extraItems={[...(sessionFindPaletteItem ? [sessionFindPaletteItem] : []), sessionSearchPaletteItem, ...terminalPaletteItems, developerModePaletteItem, diagnosticsCopyPaletteItem, diagnosticsExportPaletteItem, nextSessionTabPaletteItem, prevSessionTabPaletteItem, reloadConfigPaletteItem]}
      listAgents={listAgents}
      selectedAgent={selectedAgent}
      onSelectAgent={setSelectedAgent}
    />
    <SessionSearchDialog
      open={sessionSearchOpen}
      onClose={() => setSessionSearchOpen(false)}
      sessions={paletteSessionOptions}
      fetchMessages={sessionSearchFetcher}
      onOpenSession={(workspaceId, sessionId) => navigateToWorkspaceSession(workspaceId, sessionId)}
    />
    <ModelPickerModal
      open={modelPicker.open}
      options={modelPicker.options}
      organizationModelsEmpty={organizationModelsEmpty}
      organizationModelsSettingsUrl={organizationModelsSettingsUrl}

      query={modelPicker.query}
      setQuery={modelPicker.setQuery}
      subtitle={selectedModelUnavailable ? MODEL_PICKER_UNAVAILABLE_SUBTITLE : undefined}
      target="default"
      current={
        (modelPickerSessionId ? getSessionModelSelection(modelPickerSessionId)?.model : null)
          ?? local.prefs.defaultModel
          ?? ({ providerID: "", modelID: "" } satisfies ModelRef)
      }
      onSelect={(next: ModelRef) => {
        if (modelPickerSessionId) {
          // Opened from a session composer: remember for that conversation
          // only, so the other split pane keeps its own model.
          useSessionModelStore.getState().setModel(modelPickerSessionId, next);
          setModelPickerSessionId(null);
        } else {
          local.setPrefs((previous) => ({
            ...previous,
            defaultModel: next,
            modelVariant: previous.defaultModel?.providerID === next.providerID && previous.defaultModel.modelID === next.modelID
              ? previous.modelVariant
              : null,
          }));
        }
        modelPicker.setOpen(false);
        focusPromptSoon();
      }}
      disabledProviders={disabledProviderIds}
      onBehaviorChange={() => {}}
      onToggleProvider={async (providerId, enable) => {
        if (!opencodeClient) return;
        try {
          const config = unwrap(await opencodeClient.config.get());
          const current = disabledProvidersFromConfig(config);
          const next = enable
            ? current.filter((id: string) => id !== providerId)
            : [...current, providerId];
          const result = await updateManagedDisabledProviders({
            opencodeClient,
            openworkClient: selectedWorkspaceEndpoint?.client ?? null,
            workspaceId: selectedWorkspaceEndpoint?.workspaceId ?? null,
            workspaceType: selectedWorkspace?.workspaceType ?? "local",
            disabledProviders: next,
            currentConfig: config,
            markReloadRequired: () => {
              reloadCoordinator.markReloadRequired("config", {
                type: "config",
                name: "runtime-opencode-config.json",
                action: "updated",
              });
            },
          });
          setDisabledProviderIds(result.disabledProviders);
        } catch {}
      }}
      onOpenSettings={() => {
        modelPicker.setOpen(false);
        handleOpenSettings("/settings/general");
      }}
      onClose={() => { modelPicker.setOpen(false); modelPicker.setRecentProviderIds(new Set()); }}
      openWorkModelsEntitled={openWorkModelsEntitled}
      openWorkModelsSyncing={openWorkModelsSyncing}
      onRefreshOrganizationModels={refreshOrganizationModelAccess}
      restrictToCloud={restrictToCloudProviders}
    />
    <CardDiff
      open={revisionReviewOpen}
      proposals={revisionProposals}
      saving={revisionBusy}
      onApply={(fields) => void handleApplyRevision(fields)}
      onClose={() => {
        setRevisionReviewOpen(false);
        setRevisionProposals([]);
      }}
    />
    <MemoryReview
      open={memoryReviewOpen}
      proposals={memoryProposals}
      saving={memoryBusy}
      onKeep={(texts) => void handleKeepMemories(texts)}
      onClose={() => {
        setMemoryReviewOpen(false);
        setMemoryProposals([]);
      }}
    />
    </WorkspaceProvider>
  );
}

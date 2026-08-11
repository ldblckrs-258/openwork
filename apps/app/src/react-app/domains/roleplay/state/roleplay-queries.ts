import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  RoleplayCardRevision,
  RoleplayCharacterRecord,
  RoleplayMemoryRecord,
  RoleplayPersonaRecord,
  RoleplaySessionBinding,
  RoleplayTurnRecord,
} from "@openwork/types/roleplay";

import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";

const ROLEPLAY_QUERY_ROOT = ["roleplay"] as const;

export function roleplayCharactersQueryKey(workspaceId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "characters", workspaceId] as const;
}

export function roleplayPersonasQueryKey(workspaceId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "personas", workspaceId] as const;
}

export function useRoleplayCharacters(endpoint: ResolvedWorkspaceEndpoint | null) {
  return useQuery({
    queryKey: roleplayCharactersQueryKey(endpoint?.workspaceId ?? ""),
    enabled: Boolean(endpoint),
    queryFn: async () => {
      if (!endpoint) return [];
      const response = await endpoint.client.listRoleplayCharacters(endpoint.workspaceId);
      return response.characters;
    },
  });
}

export function useRoleplayPersonas(endpoint: ResolvedWorkspaceEndpoint | null) {
  return useQuery({
    queryKey: roleplayPersonasQueryKey(endpoint?.workspaceId ?? ""),
    enabled: Boolean(endpoint),
    queryFn: async () => {
      if (!endpoint) return [];
      const response = await endpoint.client.listRoleplayPersonas(endpoint.workspaceId);
      return response.personas;
    },
  });
}

/**
 * Characters and personas share one JSON document per workspace, so a write
 * rewrites the whole thing. Refetching after every mutation keeps the list
 * honest rather than patching a local copy that could drift from what the
 * serializer actually persisted.
 */
async function invalidateCharacters(queryClient: QueryClient, workspaceId: string) {
  await queryClient.invalidateQueries({ queryKey: roleplayCharactersQueryKey(workspaceId) });
}

export function useSaveRoleplayCharacter(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (character: RoleplayCharacterRecord) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      const response = await endpoint.client.putRoleplayCharacter(endpoint.workspaceId, character);
      return response.character;
    },
    onSuccess: async () => {
      if (endpoint) await invalidateCharacters(queryClient, endpoint.workspaceId);
    },
  });
}

export function useDeleteRoleplayCharacter(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      const response = await endpoint.client.deleteRoleplayCharacter(endpoint.workspaceId, characterId);
      return response.deleted;
    },
    onSuccess: async () => {
      if (endpoint) await invalidateCharacters(queryClient, endpoint.workspaceId);
    },
  });
}

export function useSaveRoleplayPersona(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (persona: RoleplayPersonaRecord) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      const response = await endpoint.client.putRoleplayPersona(endpoint.workspaceId, persona);
      return response.persona;
    },
    onSuccess: async () => {
      if (endpoint) await queryClient.invalidateQueries({ queryKey: roleplayPersonasQueryKey(endpoint.workspaceId) });
    },
  });
}

export function useDeleteRoleplayPersona(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (personaId: string) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      const response = await endpoint.client.deleteRoleplayPersona(endpoint.workspaceId, personaId);
      return response.deleted;
    },
    onSuccess: async () => {
      if (endpoint) await queryClient.invalidateQueries({ queryKey: roleplayPersonasQueryKey(endpoint.workspaceId) });
    },
  });
}

export function roleplaySessionQueryKey(workspaceId: string, sessionId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "session", workspaceId, sessionId] as const;
}

/**
 * The binding decides whether a session is a roleplay session, which gates both
 * the composer's block triggers and the send path's agent pin. It is therefore
 * read on every session, so an unbound session must resolve to a cheap, cached
 * "no" rather than an error.
 */
export function useRoleplaySessionBinding(endpoint: ResolvedWorkspaceEndpoint | null, sessionId: string | null) {
  return useQuery({
    queryKey: roleplaySessionQueryKey(endpoint?.workspaceId ?? "", sessionId ?? ""),
    enabled: Boolean(endpoint) && Boolean(sessionId),
    staleTime: 30_000,
    queryFn: async () => {
      if (!endpoint || !sessionId) return null;
      return endpoint.client.getRoleplaySessionBinding(endpoint.workspaceId, sessionId);
    },
  });
}

export function roleplayTurnsQueryKey(workspaceId: string, sessionId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "turns", workspaceId, sessionId] as const;
}

export function useRoleplayTurns(endpoint: ResolvedWorkspaceEndpoint | null, sessionId: string | null) {
  return useQuery({
    queryKey: roleplayTurnsQueryKey(endpoint?.workspaceId ?? "", sessionId ?? ""),
    enabled: Boolean(endpoint) && Boolean(sessionId),
    queryFn: async () => {
      if (!endpoint || !sessionId) return [];
      return (await endpoint.client.listRoleplayTurns(endpoint.workspaceId, sessionId)).turns;
    },
  });
}

export function useSaveRoleplayTurn(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (turn: RoleplayTurnRecord) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      return (await endpoint.client.putRoleplayTurn(endpoint.workspaceId, turn)).turn;
    },
    onSuccess: async (turn) => {
      if (endpoint) {
        await queryClient.invalidateQueries({ queryKey: roleplayTurnsQueryKey(endpoint.workspaceId, turn.sessionId) });
      }
    },
  });
}

export function roleplayMemoriesQueryKey(workspaceId: string, characterId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "memories", workspaceId, characterId] as const;
}

/**
 * Memories are read on every roleplay session, because they are compiled into
 * `system` on every turn. An unbound or memory-less character must therefore
 * resolve to a cheap cached empty list rather than to an error.
 */
export function useRoleplayMemories(endpoint: ResolvedWorkspaceEndpoint | null, characterId: string | null) {
  return useQuery({
    queryKey: roleplayMemoriesQueryKey(endpoint?.workspaceId ?? "", characterId ?? ""),
    enabled: Boolean(endpoint) && Boolean(characterId),
    staleTime: 30_000,
    queryFn: async () => {
      if (!endpoint || !characterId) return [];
      return (await endpoint.client.listRoleplayMemories(endpoint.workspaceId, characterId)).memories;
    },
  });
}

export function useSaveRoleplayMemory(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memory: RoleplayMemoryRecord) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      return (await endpoint.client.putRoleplayMemory(endpoint.workspaceId, memory)).memory;
    },
    onSuccess: async (memory) => {
      if (endpoint) {
        await queryClient.invalidateQueries({
          queryKey: roleplayMemoriesQueryKey(endpoint.workspaceId, memory.characterId),
        });
      }
    },
  });
}

export function useDeleteRoleplayMemory(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memoryId: string; characterId: string }) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      await endpoint.client.deleteRoleplayMemory(endpoint.workspaceId, input.memoryId);
      return input;
    },
    onSuccess: async (input) => {
      if (endpoint) {
        await queryClient.invalidateQueries({
          queryKey: roleplayMemoriesQueryKey(endpoint.workspaceId, input.characterId),
        });
      }
    },
  });
}

export function roleplayRevisionsQueryKey(workspaceId: string, characterId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "revisions", workspaceId, characterId] as const;
}

export function useRoleplayRevisions(endpoint: ResolvedWorkspaceEndpoint | null, characterId: string | null) {
  return useQuery({
    queryKey: roleplayRevisionsQueryKey(endpoint?.workspaceId ?? "", characterId ?? ""),
    enabled: Boolean(endpoint) && Boolean(characterId),
    queryFn: async () => {
      if (!endpoint || !characterId) return [];
      return (await endpoint.client.listRoleplayRevisions(endpoint.workspaceId, characterId)).revisions;
    },
  });
}

/**
 * Write the revision and the revised character together.
 *
 * They are two documents with no transaction between them, so the order matters:
 * the revision — the copy of the card as it was — is written first. A crash
 * between the two then leaves a harmless extra history entry rather than a
 * changed card with no way back.
 */
export function useApplyRoleplayRevision(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { revision: RoleplayCardRevision; character: RoleplayCharacterRecord }) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      await endpoint.client.putRoleplayRevision(endpoint.workspaceId, input.revision);
      return (await endpoint.client.putRoleplayCharacter(endpoint.workspaceId, input.character)).character;
    },
    onSuccess: async (character) => {
      if (!endpoint) return;
      await invalidateCharacters(queryClient, endpoint.workspaceId);
      await queryClient.invalidateQueries({
        queryKey: roleplayRevisionsQueryKey(endpoint.workspaceId, character.id),
      });
    },
  });
}

export function useBindRoleplaySession(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (binding: RoleplaySessionBinding) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      const response = await endpoint.client.putRoleplaySessionBinding(endpoint.workspaceId, binding);
      return response.binding;
    },
    onSuccess: async (binding) => {
      if (endpoint) {
        await queryClient.invalidateQueries({ queryKey: roleplaySessionQueryKey(endpoint.workspaceId, binding.sessionId) });
      }
    },
  });
}

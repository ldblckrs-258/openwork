import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  RoleplayCardRevision,
  RoleplayCharacterRecord,
  RoleplayLorebookRecord,
  RoleplayMemoryRecord,
  RoleplayPersonaRecord,
  RoleplaySessionBinding,
  RoleplaySkillRef,
  RoleplaySceneState,
  RoleplayTurnRecord,
  SceneStatePatch,
} from "@openwork/types/roleplay";

import { classifyResolvedSkill, type RoleplayAttachedSkill } from "@/app/roleplay/skills-injection";
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

export function useUpdateRoleplaySceneState(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; patch: SceneStatePatch }) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      return endpoint.client.patchRoleplaySceneState(endpoint.workspaceId, input.sessionId, input.patch);
    },
    onSuccess: async (_result, input) => {
      if (endpoint) {
        await queryClient.invalidateQueries({
          queryKey: roleplaySessionQueryKey(endpoint.workspaceId, input.sessionId),
        });
      }
    },
  });
}

export function useRestoreRoleplaySceneState(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; snapshot: RoleplaySceneState }) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      return endpoint.client.restoreRoleplaySceneState(endpoint.workspaceId, input.sessionId, input.snapshot);
    },
    onSuccess: async (_result, input) => {
      if (endpoint) {
        await queryClient.invalidateQueries({
          queryKey: roleplaySessionQueryKey(endpoint.workspaceId, input.sessionId),
        });
      }
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

export function useDeleteRoleplayTurns(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; turnIds: string[] }) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      return (await endpoint.client.deleteRoleplayTurns(endpoint.workspaceId, input.sessionId, input.turnIds)).deleted;
    },
    onSuccess: async (_deleted, input) => {
      if (endpoint) {
        await queryClient.invalidateQueries({
          queryKey: roleplayTurnsQueryKey(endpoint.workspaceId, input.sessionId),
        });
      }
    },
  });
}

export function roleplayMemoriesQueryKey(workspaceId: string, characterId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "memories", workspaceId, characterId] as const;
}

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

export function roleplayLorebooksQueryKey(workspaceId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "lorebooks", workspaceId] as const;
}

export function useRoleplayLorebooks(endpoint: ResolvedWorkspaceEndpoint | null) {
  return useQuery({
    queryKey: roleplayLorebooksQueryKey(endpoint?.workspaceId ?? ""),
    enabled: Boolean(endpoint),
    staleTime: 30_000,
    queryFn: async () => {
      if (!endpoint) return [];
      return (await endpoint.client.listRoleplayLorebooks(endpoint.workspaceId)).lorebooks;
    },
  });
}

export function useSaveRoleplayLorebook(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lorebook: RoleplayLorebookRecord) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      return (await endpoint.client.putRoleplayLorebook(endpoint.workspaceId, lorebook)).lorebook;
    },
    onSuccess: async () => {
      if (endpoint) await queryClient.invalidateQueries({ queryKey: roleplayLorebooksQueryKey(endpoint.workspaceId) });
    },
  });
}

export function useDeleteRoleplayLorebook(endpoint: ResolvedWorkspaceEndpoint | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lorebookId: string) => {
      if (!endpoint) throw new Error("No workspace is selected.");
      return (await endpoint.client.deleteRoleplayLorebook(endpoint.workspaceId, lorebookId)).deleted;
    },
    onSuccess: async () => {
      if (endpoint) await queryClient.invalidateQueries({ queryKey: roleplayLorebooksQueryKey(endpoint.workspaceId) });
    },
  });
}

export function workspaceSkillsQueryKey(workspaceId: string) {
  return [...ROLEPLAY_QUERY_ROOT, "skills", workspaceId] as const;
}

export function workspaceSkillBodyQueryKey(workspaceId: string, name: string) {
  return [...ROLEPLAY_QUERY_ROOT, "skill-body", workspaceId, name] as const;
}

export function useWorkspaceSkills(endpoint: ResolvedWorkspaceEndpoint | null) {
  return useQuery({
    queryKey: workspaceSkillsQueryKey(endpoint?.workspaceId ?? ""),
    enabled: Boolean(endpoint),
    staleTime: 30_000,
    queryFn: async () => {
      if (!endpoint) return [];
      return (await endpoint.client.listSkills(endpoint.workspaceId, { includeGlobal: true })).items;
    },
  });
}

export function useAttachedSkillBodies(endpoint: ResolvedWorkspaceEndpoint | null, refs: RoleplaySkillRef[]) {
  return useQueries({
    queries: refs.map((ref) => ({
      queryKey: workspaceSkillBodyQueryKey(endpoint?.workspaceId ?? "", ref.name),
      enabled: Boolean(endpoint),
      staleTime: 30_000,
      retry: false,
      queryFn: async (): Promise<RoleplayAttachedSkill> => {
        if (!endpoint) return classifyResolvedSkill(ref, null);
        try {
          const resolved = await endpoint.client.getSkill(endpoint.workspaceId, ref.name, { includeGlobal: true });
          return classifyResolvedSkill(ref, { scope: resolved.item.scope, content: resolved.content });
        } catch {
          return classifyResolvedSkill(ref, null);
        }
      },
    })),
    combine: (results) => ({
      skills: results.flatMap((result) => (result.data ? [result.data] : [])),
      pending: results.some((result) => result.isPending),
    }),
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

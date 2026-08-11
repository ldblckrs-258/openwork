import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RoleplayCharacterRecord, RoleplayPersonaRecord, RoleplaySessionBinding } from "@openwork/types/roleplay";

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

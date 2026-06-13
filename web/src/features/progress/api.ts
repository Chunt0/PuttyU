/**
 * Progress / ensemble-graph server-state hooks (Phase-2 T3b — SPEC F5, ADR 0005).
 *
 * graph_routes.py was born typed, so everything here rides the real OpenAPI seam.
 * The read side feeds the state-colored concept tree, the trajectory timeline and
 * the "about you" observations; the two write doors are the student-outranks-the-
 * model actions — mastery override and insight challenge (invalidate, never erase).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type {
  GraphAssertion,
  GraphChallengeResult,
  GraphConceptDetail,
  GraphConceptNode,
  GraphOverrideResult,
} from "../../api/types.ts";

export const conceptTreeKey = (courseId: string | null) =>
  ["graph-concepts", courseId ?? "all"] as const;
export const conceptDetailKey = (conceptId: string) => ["graph-concept", conceptId] as const;
export const observationsKey = (courseId: string | null) =>
  ["graph-observations", courseId ?? "all"] as const;

/** The course region's concept tree, nested by heading_path (server-side). */
export function useConceptTree(courseId: string | null) {
  return useQuery({
    queryKey: conceptTreeKey(courseId),
    enabled: courseId !== null,
    queryFn: async (): Promise<GraphConceptNode[]> => {
      const { data, error } = await api.GET("/api/graph/concepts", {
        params: { query: { course_id: courseId } },
      });
      if (error || !data) throw new Error("failed to load concepts");
      return data.concepts ?? [];
    },
  });
}

/** Everything behind one node's state: evidence rows + the full assertion timeline. */
export function useConceptDetail(conceptId: string | null) {
  return useQuery({
    queryKey: conceptDetailKey(conceptId ?? ""),
    enabled: conceptId !== null,
    queryFn: async (): Promise<GraphConceptDetail> => {
      const { data, error } = await api.GET("/api/graph/concepts/{concept_id}", {
        params: { path: { concept_id: conceptId ?? "" } },
      });
      if (error || !data) throw new Error("failed to load concept");
      return data;
    },
  });
}

/** Stated observations, newest first (course-scoped concept rows + global ones). */
export function useObservations(courseId: string | null) {
  return useQuery({
    queryKey: observationsKey(courseId),
    enabled: courseId !== null,
    queryFn: async (): Promise<GraphAssertion[]> => {
      const { data, error } = await api.GET("/api/graph/observations", {
        params: { query: { course_id: courseId } },
      });
      if (error || !data) throw new Error("failed to load observations");
      return data.observations ?? [];
    },
  });
}

/** "I know this" / "I never learned this" — an override is appended evidence. */
export function useOverrideConcept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      conceptId: string;
      known: boolean;
    }): Promise<GraphOverrideResult> => {
      const { data, error } = await api.POST("/api/graph/concepts/{concept_id}/override", {
        params: { path: { concept_id: input.conceptId } },
        body: { known: input.known },
      });
      if (error || !data) throw new Error("failed to record override");
      return data;
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["graph-concepts"] });
      void qc.invalidateQueries({ queryKey: conceptDetailKey(v.conceptId) });
    },
  });
}

/** Challenge an inferred insight: invalidates it and records the correction as stated. */
export function useChallengeAssertion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      assertionId: string;
      correction: string;
    }): Promise<GraphChallengeResult> => {
      const { data, error } = await api.POST("/api/graph/assertions/{assertion_id}/challenge", {
        params: { path: { assertion_id: input.assertionId } },
        body: { correction: input.correction },
      });
      if (error || !data) throw new Error("failed to record challenge");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["graph-concept"] });
      void qc.invalidateQueries({ queryKey: ["graph-observations"] });
    },
  });
}

/** Courses server-state hooks over the typed client (course_routes is born typed → real seam). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { Course, CourseSources } from "../../api/types.ts";

export const coursesKey = ["courses"] as const;

/** All courses (active + archived); components filter by `status`. */
export function useCourses() {
  return useQuery({
    queryKey: coursesKey,
    queryFn: async (): Promise<Course[]> => {
      const { data, error } = await api.GET("/api/courses");
      if (error || !data) throw new Error("failed to load courses");
      return data.courses ?? [];
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: coursesKey });
}

export function useCreateCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Course> => {
      const { data, error } = await api.POST("/api/courses", { body: { name } });
      if (error || !data) throw new Error("failed to create course");
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }): Promise<Course> => {
      const { data, error } = await api.PATCH("/api/courses/{course_id}", {
        params: { path: { course_id: id } },
        body: { name },
      });
      if (error || !data) throw new Error("failed to update course");
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useArchiveCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Course> => {
      const { data, error } = await api.POST("/api/courses/{course_id}/archive", {
        params: { path: { course_id: id } },
      });
      if (error || !data) throw new Error("failed to archive course");
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUnarchiveCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Course> => {
      const { data, error } = await api.POST("/api/courses/{course_id}/unarchive", {
        params: { path: { course_id: id } },
      });
      if (error || !data) throw new Error("failed to unarchive course");
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
}

/** Linked library source ids for one course (drives the honest no-sources chip). */
export function useCourseSources(courseId: string | null) {
  return useQuery({
    queryKey: ["course-sources", courseId] as const,
    enabled: courseId !== null,
    queryFn: async (): Promise<CourseSources> => {
      const { data, error } = await api.GET("/api/courses/{course_id}/sources", {
        params: { path: { course_id: courseId ?? "" } },
      });
      if (error || !data) throw new Error("failed to load course sources");
      return data;
    },
  });
}

export function useReplaceCourseSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, sourceIds }: { id: string; sourceIds: string[] }) => {
      const { data, error } = await api.PUT("/api/courses/{course_id}/sources", {
        params: { path: { course_id: id } },
        body: { source_ids: sourceIds },
      });
      if (error || !data) throw new Error("failed to update course sources");
      return data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["course-sources", v.id] }),
  });
}

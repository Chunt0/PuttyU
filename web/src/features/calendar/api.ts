/** Calendar server-state hooks (hand-typed; see ./types.ts for why). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson, putJson, del } from "../../api/forms.ts";
import type {
  CalDAVConfig,
  CalDAVSaveInput,
  CalendarEvent,
  CalendarsResponse,
  EventInput,
  EventsResponse,
} from "./types.ts";

export const eventsKey = (start: string, end: string) => ["calendar", "events", start, end] as const;
export const calendarsKey = ["calendar", "calendars"] as const;
export const caldavKey = ["calendar", "config"] as const;

/** Events whose start/end fall in [start, end) — ISO date strings (e.g. month bounds). */
export function useEvents(start: string, end: string) {
  return useQuery({
    queryKey: eventsKey(start, end),
    queryFn: async (): Promise<CalendarEvent[]> => {
      const q = `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      return (await getJson<EventsResponse>(`/api/calendar/events${q}`)).events ?? [];
    },
  });
}

export function useCalendars() {
  return useQuery({
    queryKey: calendarsKey,
    queryFn: async () => (await getJson<CalendarsResponse>("/api/calendar/calendars")).calendars ?? [],
    staleTime: 60_000,
  });
}

const invalidateEvents = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ["calendar", "events"] });

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EventInput) => postJson<{ ok: boolean; uid: string }>("/api/calendar/events", input),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uid, input }: { uid: string; input: EventInput }) =>
      putJson<{ ok: boolean }>(`/api/calendar/events/${encodeURIComponent(uid)}`, input),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uid: string) => del<{ ok: boolean }>(`/api/calendar/events/${encodeURIComponent(uid)}`),
    onSuccess: () => invalidateEvents(qc),
  });
}

// --- CalDAV ---------------------------------------------------------------------------
export function useCalDAVConfig() {
  return useQuery({
    queryKey: caldavKey,
    queryFn: () => getJson<CalDAVConfig>("/api/calendar/config"),
    staleTime: 60_000,
  });
}

export function useSyncCalDAV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<{ ok: boolean; added?: number; updated?: number }>("/api/calendar/sync"),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useTestCalDAV() {
  return useMutation({
    mutationFn: (input: CalDAVSaveInput) => postJson<{ ok: boolean; error?: string }>("/api/calendar/test", input),
  });
}

export function useSaveCalDAV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CalDAVSaveInput) => postJson<{ ok: boolean }>("/api/calendar/config", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: caldavKey }),
  });
}

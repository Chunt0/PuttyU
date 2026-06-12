import { useState, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import {
  useMemories,
  useAddMemory,
  useDeleteMemory,
  useSearchMemories,
  MEMORY_CATEGORIES,
  type MemoryCategory,
} from "./api.ts";
import type { MemoryItem } from "../../api/types.ts";

/** Memory: the agent's long-term facts about the user — list, add, search, delete. */
export function Memory() {
  const memories = useMemories();
  const addMemory = useAddMemory();
  const deleteMemory = useDeleteMemory();
  const search = useSearchMemories();

  const [text, setText] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("fact");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!text.trim()) return;
    try {
      await addMemory.mutateAsync({ text: text.trim(), category });
      setText("");
      setResults(null);
    } catch {
      setError("Could not save that memory.");
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!query.trim()) {
      setResults(null);
      return;
    }
    try {
      const res = await search.mutateAsync(query.trim());
      setResults(res.memories ?? []);
    } catch {
      setError("Search failed.");
    }
  }

  function clearSearch() {
    setQuery("");
    setResults(null);
  }

  const shown = results ?? memories.data ?? [];

  return (
    <section className="memory">
      <h1>Memory</h1>

      <form className="memory-add" onSubmit={onAdd}>
        <h2>Add a memory</h2>
        <textarea
          aria-label="Memory text"
          placeholder="Something to remember about the user…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
        <div className="memory-add-row">
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as MemoryCategory)}
          >
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!text.trim() || addMemory.isPending}>
            {addMemory.isPending ? "Saving…" : "Add"}
          </button>
        </div>
      </form>

      <form className="memory-search" onSubmit={onSearch} role="search">
        <input
          aria-label="Search memories"
          placeholder="Search memories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={search.isPending}>
          {search.isPending ? "Searching…" : "Search"}
        </button>
        {results !== null && (
          <button type="button" onClick={clearSearch}>
            Clear
          </button>
        )}
      </form>

      {error && <p className="memory-error" role="alert">{error}</p>}

      <div className="memory-list">
        <h2>
          {results !== null ? `Results (${shown.length})` : `All memories (${shown.length})`}
        </h2>
        {memories.isLoading && <Spinner label="Loading memories…" />}
        {!memories.isLoading && shown.length === 0 && (
          <p className="memory-empty">
            {results !== null ? "No matches." : "No memories yet."}
          </p>
        )}
        <ul>
          {shown.map((m) => (
            <li key={m.id} className="memory-row">
              <span className="memory-cat">{m.category}</span>
              <span className="memory-text">{m.text}</span>
              <ConfirmButton
                className="memory-delete"
                title={`Delete memory ${m.id}`}
                onConfirm={() => deleteMemory.mutate(m.id)}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

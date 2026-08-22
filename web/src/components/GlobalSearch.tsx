import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api, type JobSearchResult } from '../api/client';
import './GlobalSearch.css';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export interface GlobalSearchProps {
  /** Deixa quem usa este componente controlar o foco de fora (ex.: atalho "/" do Dashboard). */
  inputRef?: RefObject<HTMLInputElement>;
}

export function GlobalSearch({ inputRef }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JobSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await api.searchJobs(trimmed);
        if (cancelled) return;
        setResults(res.results);
        setHighlightedIndex(-1);
        setIsOpen(true);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function selectResult(result: JobSearchResult) {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    navigate(`/jobs/${result.id}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectResult(results[highlightedIndex >= 0 ? highlightedIndex : 0]);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  }

  return (
    <div className="global-search" ref={containerRef}>
      <Search size={18} aria-hidden="true" className="global-search-icon" />
      <input
        ref={inputRef}
        type="text"
        className="global-search-input"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="global-search-listbox"
        aria-autocomplete="list"
        aria-label="Pesquisar no sistema"
        placeholder="Pesquisar qualquer coisa no sistema… (atalho: /)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (results.length > 0) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      {isOpen && (
        <ul className="global-search-dropdown" id="global-search-listbox" role="listbox">
          {loading && <li className="global-search-status">Buscando…</li>}
          {!loading && results.length === 0 && <li className="global-search-status">Nenhum resultado.</li>}
          {!loading &&
            results.map((result, index) => (
              <li key={result.id} role="option" aria-selected={index === highlightedIndex}>
                <button
                  type="button"
                  className={`global-search-result${index === highlightedIndex ? ' is-highlighted' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectResult(result)}
                >
                  <span className="global-search-result-name">{result.name}</span>
                  {(result.client || result.code) && (
                    <span className="global-search-result-meta">
                      {[result.client, result.code].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {result.matchContext && (
                    <span className="global-search-result-context">{result.matchContext}</span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

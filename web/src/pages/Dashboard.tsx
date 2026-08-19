import { useEffect, useState, type FormEvent } from 'react';
import { api, type Job } from '../api/client';

export function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [client, setClient] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refreshJobs() {
    const res = await api.listJobs();
    setJobs(res.jobs);
  }

  useEffect(() => {
    refreshJobs().catch(() => setError('Não foi possível carregar os jobs.'));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Informe o nome do job.');
      return;
    }

    try {
      await api.createJob({
        name: name.trim(),
        code: code.trim() || undefined,
        client: client.trim() || undefined,
      });
      setName('');
      setCode('');
      setClient('');
      await refreshJobs();
    } catch {
      setError('Não foi possível criar o job.');
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Jobs</h1>

      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem' }}>
        <div>
          <label htmlFor="job-name">Nome</label>
          <input id="job-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="job-code">Código</label>
          <input id="job-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label htmlFor="job-client">Cliente</label>
          <input id="job-client" value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
        <button type="submit">Adicionar job</button>
        {error && <p role="alert">{error}</p>}
      </form>

      {jobs.length === 0 ? (
        <p>Nenhum job cadastrado ainda.</p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <strong>{job.name}</strong>
              {job.code ? ` — ${job.code}` : ''}
              {job.client ? ` (${job.client})` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

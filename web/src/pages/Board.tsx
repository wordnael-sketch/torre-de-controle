import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Job, type Phase, type AlertLevel } from '../api/client';

const ALERT_COLOR: Record<AlertLevel, string> = {
  green: '#2e7d32',
  yellow: '#f9a825',
  red: '#c62828',
};

export function Board() {
  const [phases, setPhases] = useState<Phase[]>([]);
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
    Promise.all([api.getReference(), api.listJobs()])
      .then(([referenceRes, jobsRes]) => {
        setPhases(referenceRes.phases);
        setJobs(jobsRes.jobs);
      })
      .catch(() => setError('Não foi possível carregar o board.'));
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
    <div style={{ maxWidth: '100%', padding: '1rem' }}>
      <h1>Board de Jobs</h1>

      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem', maxWidth: 640 }}>
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

      <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto' }}>
        {phases.map((phase) => (
          <div key={phase.id} style={{ minWidth: 260, flex: '0 0 auto' }}>
            <h2>{phase.name}</h2>
            {jobs
              .filter((job) => job.phaseId === phase.id && !job.completedAt)
              .map((job) => (
                <Link
                  key={job.id}
                  to={`/jobs/${job.id}`}
                  style={{
                    display: 'block',
                    border: '1px solid #ccc',
                    borderLeft: `4px solid ${ALERT_COLOR[job.alertLevel]}`,
                    borderRadius: 4,
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <strong>{job.name}</strong>
                  {job.client ? ` (${job.client})` : ''}
                  <div>{job.statusName}</div>
                  {job.highlightedPersonName && <div>{job.highlightedPersonName}</div>}
                </Link>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

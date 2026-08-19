import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type JobDetail, type Phase, type Person } from '../api/client';

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);

  const [job, setJob] = useState<JobDetail | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [jobRes, referenceRes, peopleRes] = await Promise.all([
      api.getJob(jobId),
      api.getReference(),
      api.listPeople(),
    ]);
    setJob(jobRes.job);
    setPhases(referenceRes.phases);
    setPeople(peopleRes.people);
  }

  useEffect(() => {
    refresh().catch(() => setError('Não foi possível carregar o job.'));
  }, [jobId]);

  async function handleAdvance() {
    setError(null);
    try {
      await api.advanceJob(jobId, undefined);
      await refresh();
    } catch {
      setError('Não foi possível avançar o status.');
    }
  }

  async function handleManualStatus(statusId: number) {
    setError(null);
    try {
      await api.setJobStatus(jobId, statusId);
      await refresh();
    } catch {
      setError('Não foi possível mudar o status manualmente.');
    }
  }

  async function handleAssignRole(area: string, personId: number | null) {
    setError(null);
    try {
      await api.assignRole(jobId, area, personId);
      await refresh();
    } catch {
      setError('Não foi possível atribuir a pessoa a esse papel.');
    }
  }

  if (!job) {
    return error ? <p role="alert">{error}</p> : <p>Carregando...</p>;
  }

  const allStatuses = phases.flatMap((phase) => phase.statuses);
  const currentPhase = phases.find((phase) => phase.id === job.phaseId);
  const currentStatusInPhase = currentPhase?.statuses.find((status) => status.id === job.statusId);
  const hasNextStatusInPhase = Boolean(
    currentPhase &&
      currentStatusInPhase &&
      currentPhase.statuses.some((status) => status.order === currentStatusInPhase.order + 1),
  );
  // Exclude the job's current status from the manual selector: it's not a
  // meaningful "change to" target, and keeping it out avoids duplicating the
  // status name's text in the DOM (it's already shown in the status line above).
  const selectableStatuses = allStatuses.filter((status) => status.id !== job.statusId);
  const peopleByArea = (area: string) => people.filter((p) => p.area === area && p.active);

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>{job.name}</h1>
      <p>
        {job.phaseName} — <strong>{job.statusName}</strong>
      </p>

      {job.actionRequired && <p>{job.actionRequired}</p>}

      {error && <p role="alert">{error}</p>}

      {job.triggerLabel && hasNextStatusInPhase && (
        <button type="button" onClick={handleAdvance}>
          {job.triggerLabel}
        </button>
      )}

      <div style={{ marginTop: '1rem' }}>
        <label htmlFor="manual-status">Mudar status manualmente</label>
        <select
          id="manual-status"
          value=""
          onChange={(e) => {
            if (e.target.value) {
              void handleManualStatus(Number(e.target.value));
            }
          }}
        >
          <option value="">Selecione...</option>
          {selectableStatuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </div>

      <h2>Responsáveis nesta fase</h2>
      <ul>
        {job.roleAssignments.map((assignment) => (
          <li key={assignment.area}>
            <span>{assignment.area}</span>{': '}
            <select
              aria-label={assignment.area}
              value={assignment.personId ?? ''}
              onChange={(e) =>
                void handleAssignRole(assignment.area, e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">(não atribuído)</option>
              {peopleByArea(assignment.area).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      <h2>Histórico</h2>
      <ul>
        {job.statusHistory.map((entry) => {
          const toStatus = allStatuses.find((s) => s.id === entry.toStatusId);
          return (
            <li key={entry.id}>
              {new Date(entry.changedAt).toLocaleString('pt-BR')} — {toStatus?.name ?? entry.toStatusId}
              {entry.note ? ` (${entry.note})` : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

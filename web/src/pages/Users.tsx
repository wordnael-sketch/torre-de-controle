import { useEffect, useState, type FormEvent } from 'react';
import { api, type User, type UserRole } from '../api/client';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await api.listUsers();
    setUsers(res.users);
  }

  useEffect(() => {
    refresh().catch(() => setError('Não foi possível carregar os usuários.'));
  }, []);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Informe o e-mail.');
      return;
    }

    try {
      await api.inviteUser({ email: email.trim(), role });
      setEmail('');
      setRole('member');
      await refresh();
    } catch {
      setError('Não foi possível convidar esse usuário.');
    }
  }

  async function handleRoleChange(id: number, newRole: UserRole) {
    setError(null);
    try {
      await api.setUserRole(id, newRole);
      await refresh();
    } catch {
      setError('Não foi possível trocar o papel desse usuário.');
    }
  }

  async function handleStatusChange(id: number, newStatus: 'active' | 'revoked') {
    setError(null);
    try {
      await api.setUserStatus(id, newStatus);
      await refresh();
    } catch {
      setError('Não foi possível mudar o status desse usuário.');
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Usuários</h1>

      <form onSubmit={handleInvite} style={{ marginBottom: '2rem' }}>
        <div>
          <label htmlFor="invite-email">E-mail</label>
          <input id="invite-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="invite-role">Papel</label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit">Convidar</button>
        {error && <p role="alert">{error}</p>}
      </form>

      <ul>
        {users.map((u) => (
          <li key={u.id}>
            <span>{u.email}</span> — {u.status} —{' '}
            <select
              aria-label={`Papel de ${u.email}`}
              value={u.role}
              onChange={(e) => void handleRoleChange(u.id, e.target.value as UserRole)}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>{' '}
            {u.status === 'revoked' ? (
              <button type="button" onClick={() => void handleStatusChange(u.id, 'active')}>
                Reativar
              </button>
            ) : (
              <button type="button" onClick={() => void handleStatusChange(u.id, 'revoked')}>
                Revogar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

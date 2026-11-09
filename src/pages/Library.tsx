import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiCopy, FiEdit2, FiMusic, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import { NavBar } from '../components/NavBar';
import {
  createProject,
  deleteProject,
  duplicateProject,
  isSupportedAudio,
  listAudio,
  listProjects,
  storageEstimate,
  updateProject,
} from '../storage/projects';
import type { AudioSummary, ProjectMeta } from '../storage/projects';

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatAgo(timestamp: number) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString();
}

type LibraryData = {
  projects: ProjectMeta[];
  audio: AudioSummary[];
  storage: { usage: number; quota: number } | null;
};

async function loadLibrary(): Promise<LibraryData> {
  const [projects, audio, storage] = await Promise.all([listProjects(), listAudio(), storageEstimate()]);
  return { projects, audio, storage };
}

/** Projects saved in this browser. Each one opens in Studio with its track and take. */
export default function LibraryPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<LibraryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadLibrary());
    } catch (err) {
      setError(`Couldn't read the library: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLibrary().then(
      (next) => {
        if (!cancelled) setData(next);
      },
      (err) => {
        if (!cancelled) setError(`Couldn't read the library: ${String(err)}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (err) {
      setError(String(err));
    }
    await reload();
  };

  const remove = (project: ProjectMeta) => {
    const extra = project.hasTake ? ' Its recorded take will be lost.' : '';
    if (!window.confirm(`Delete "${project.name}"?${extra}`)) return;
    void run(() => deleteProject(project.id));
  };

  const projects = data?.projects ?? [];

  return (
    <div className="app">
      <NavBar />

      <div className="card library">
        <div className="library__header">
          <div>
            <h1>Library</h1>
            <p className="studio-hint">
              Projects are saved in this browser, track and take included. Several projects can use the
              same track.
            </p>
          </div>
          {!showForm && (
            <button type="button" className="library__add" onClick={() => setShowForm(true)}>
              <FiPlus /> New project
            </button>
          )}
        </div>

        {error && (
          <div className="error">
            {error}{' '}
            <button type="button" className="link-button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {showForm && (
          <NewProjectForm
            audio={data?.audio ?? []}
            onCancel={() => setShowForm(false)}
            onCreated={(project) => navigate(`/studio/${project.id}`)}
          />
        )}

        {data === null ? (
          <p className="studio-hint">Loading...</p>
        ) : projects.length === 0 ? (
          !showForm && (
            <div className="library__empty">
              <FiMusic />
              <p>No projects yet. Create one to load a track and start singing over it.</p>
            </div>
          )
        ) : (
          <ul className="library__list">
            {projects.map((project) => (
              <li key={project.id} className="library__item">
                <div className="library__info">
                  {renamingId === project.id ? (
                    <RenameField
                      initial={project.name}
                      onDone={(name) => {
                        setRenamingId(null);
                        if (name && name !== project.name) void run(() => updateProject(project.id, { name }));
                      }}
                    />
                  ) : (
                    <Link to={`/studio/${project.id}`} className="library__name">
                      {project.name}
                    </Link>
                  )}
                  <div className="library__meta">
                    {project.fileName ? (
                      <span className="file-meta">
                        {project.fileName}
                        {formatDuration(project.duration) && ` · ${formatDuration(project.duration)}`}
                      </span>
                    ) : (
                      <span className="file-meta">No track</span>
                    )}
                    {project.hasTake && <span className="library__badge">Take</span>}
                    <span className="studio-hint">Edited {formatAgo(project.updatedAt)}</span>
                  </div>
                </div>
                <div className="library__actions">
                  <button type="button" onClick={() => navigate(`/studio/${project.id}`)}>
                    Open in Studio
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setRenamingId(project.id)}
                    title="Rename"
                    aria-label={`Rename ${project.name}`}
                  >
                    <FiEdit2 />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void run(() => duplicateProject(project.id))}
                    title="Duplicate (shares the track, copies the take)"
                    aria-label={`Duplicate ${project.name}`}
                  >
                    <FiCopy />
                  </button>
                  <button
                    type="button"
                    className="icon-button library__delete"
                    onClick={() => remove(project)}
                    title="Delete"
                    aria-label={`Delete ${project.name}`}
                  >
                    <FiTrash2 />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {data?.storage && data.storage.usage > 0 && (
          <p className="studio-hint library__storage">
            Using {formatBytes(data.storage.usage)}
            {data.storage.quota > 0 && ` of ${formatBytes(data.storage.quota)} available to this site`}
          </p>
        )}
      </div>
    </div>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);
  const finish = (name: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(name);
  };
  return (
    <input
      className="library__rename"
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value.trim() || null);
        if (event.key === 'Escape') finish(null);
      }}
      aria-label="Project name"
    />
  );
}

type FormProps = {
  audio: AudioSummary[];
  onCancel: () => void;
  onCreated: (project: ProjectMeta) => void;
};

function NewProjectForm({ audio, onCancel, onCreated }: FormProps) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [audioId, setAudioId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (file && !isSupportedAudio(file)) {
      setError('Please choose an MP3 file.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await createProject({ name, file, audioId: file ? null : audioId || null });
      onCreated(project);
    } catch (err) {
      setError(`Couldn't create the project: ${String(err)}`);
      setBusy(false);
    }
  };

  const fileLabel = file ? file.name.replace(/\.[^.]+$/, '') : null;
  const reusedLabel = audio.find((item) => item.id === audioId)?.fileName.replace(/\.[^.]+$/, '') ?? null;

  return (
    <form className="library__form" onSubmit={(event) => void submit(event)}>
      <label className="library__field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          placeholder={fileLabel ?? reusedLabel ?? 'Untitled project'}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </label>

      <div className="library__field">
        <span>Track</span>
        <div className="file-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
          />
          {file && (
            <button
              type="button"
              className="icon-button"
              aria-label="Remove file"
              onClick={() => {
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              <FiX />
            </button>
          )}
          {audio.length > 0 && (
            <select
              value={file ? '' : audioId}
              disabled={Boolean(file)}
              onChange={(event) => setAudioId(event.target.value)}
              aria-label="Reuse a track from the library"
            >
              <option value="">or reuse a track in the library...</option>
              {audio.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fileName} ({formatBytes(item.size)})
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="studio-hint">Optional. You can add a track later in Studio.</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="library__form-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Creating...' : 'Create and open'}
        </button>
        <button type="button" className="toggle-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

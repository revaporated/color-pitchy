import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiChevronRight, FiCopy, FiEdit2, FiMoreHorizontal, FiMusic, FiPlus, FiTrash2, FiUpload, FiX } from 'react-icons/fi';
import { NavBar } from '../components/NavBar';
import { MenuItem, Popover } from '../components/Popover';
import {
  AUDIO_ACCEPT,
  createProject,
  deleteProject,
  duplicateProject,
  isSupportedAudio,
  libraryStatus,
  listAudio,
  listProjects,
  storageEstimate,
  UNSUPPORTED_AUDIO_MESSAGE,
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
  analyzedAudio: Set<string>;
  editCounts: Map<string, number>;
};

async function loadLibrary(): Promise<LibraryData> {
  const [projects, audio, storage, status] = await Promise.all([
    listProjects(),
    listAudio(),
    storageEstimate(),
    libraryStatus(),
  ]);
  return { projects, audio, storage, ...status };
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
            <p className="hint">
              Projects are saved in this browser, track and take included. Several projects can use the same
              track.
            </p>
          </div>
          {!showForm && projects.length > 0 && (
            <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
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
          <p className="hint">Loading...</p>
        ) : projects.length === 0 ? (
          !showForm && (
            <div className="library__empty">
              <FiMusic aria-hidden="true" />
              <p>No projects yet. Create one to load a track and start singing over it.</p>
              <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
                <FiPlus /> New project
              </button>
            </div>
          )
        ) : (
          <ul className="library__list">
            {projects.map((project) => {
              const analyzed = project.audioId !== null && data.analyzedAudio.has(project.audioId);
              const edits = data.editCounts.get(project.id) ?? 0;
              const info = (
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
                    <span className="library__name">{project.name}</span>
                  )}
                  <div className="library__meta">
                    {project.fileName ? (
                      <span className="file-meta">
                        {project.fileName}
                        {formatDuration(project.duration) && ` · ${formatDuration(project.duration)}`}
                      </span>
                    ) : (
                      <span className="hint">No track</span>
                    )}
                    {analyzed && <span className="badge badge--analyzed">Analyzed</span>}
                    {edits > 0 && (
                      <span className="badge badge--edits">
                        {edits} edit{edits === 1 ? '' : 's'}
                      </span>
                    )}
                    {project.hasTake && <span className="badge badge--take">Take</span>}
                    <span className="hint">Edited {formatAgo(project.updatedAt)}</span>
                  </div>
                </div>
              );
              return (
                <li key={project.id} className="library__item">
                  {renamingId === project.id ? (
                    <div className="library__row">{info}</div>
                  ) : (
                    <Link to={`/studio/${project.id}`} className="library__row" aria-label={`Open ${project.name} in Studio`}>
                      {info}
                      <FiChevronRight aria-hidden="true" />
                    </Link>
                  )}
                  <Popover
                    kind="menu"
                    label={`${project.name} actions`}
                    trigger={(trigger) => (
                      <button
                        type="button"
                        className="icon-button btn-ghost"
                        {...trigger}
                        aria-label={`More actions for ${project.name}`}
                        title="More actions"
                      >
                        <FiMoreHorizontal />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem close={close} icon={<FiEdit2 />} onSelect={() => setRenamingId(project.id)}>
                          Rename
                        </MenuItem>
                        <MenuItem
                          close={close}
                          icon={<FiCopy />}
                          onSelect={() => void run(() => duplicateProject(project.id))}
                          title="Shares the track, copies the take"
                        >
                          Duplicate
                        </MenuItem>
                        <div className="menu__sep" role="separator" />
                        <MenuItem close={close} icon={<FiTrash2 />} onSelect={() => remove(project)} danger>
                          Delete...
                        </MenuItem>
                      </>
                    )}
                  </Popover>
                </li>
              );
            })}
          </ul>
        )}

        {data?.storage && data.storage.usage > 0 && (
          <p className="hint library__storage">
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
      type="text"
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
      setError(UNSUPPORTED_AUDIO_MESSAGE);
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
            accept={AUDIO_ACCEPT}
            hidden
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
          />
          <span className="file-picker">
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              <FiUpload /> {file ? 'Choose a different file' : 'Choose audio file'}
            </button>
            {file && (
              <>
                <span className="file-meta">{file.name}</span>
                <button
                  type="button"
                  className="icon-button btn-ghost"
                  aria-label="Remove file"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  <FiX />
                </button>
              </>
            )}
          </span>
          {audio.length > 0 && !file && (
            <select
              value={audioId}
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
        <span className="hint">Optional: MP3, WAV, M4A, FLAC or OGG. You can add a track later in Studio.</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="library__form-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Creating...' : 'Create and open'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

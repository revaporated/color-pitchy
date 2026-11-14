import { useEffect, useState, useSyncExternalStore } from 'react';
import { EMPTY_EDITS } from '../audio/noteEdits';
import { getEdits, rememberProjectSettings, saveEdits, updateProject } from '../storage/projects';
import type { ProjectMeta } from './projectDoc';
import { ProjectStore, type ProjectPersistence, type ProjectState } from './projectStore';

function libraryPersistence(projectId: string): ProjectPersistence {
  return {
    saveSettings: (settings) => {
      // The next new project starts from these.
      rememberProjectSettings(settings);
      return updateProject(projectId, { settings });
    },
    saveEdits: (edits) => saveEdits(projectId, edits),
    saveBeats: (beats) => updateProject(projectId, { beats }, { touch: false }),
  };
}

/**
 * The open project's store, saved to the library. Loads the saved note edits,
 * and saves pending changes when the tab is hidden or Studio closes.
 */
export function useProjectStore(project: ProjectMeta): ProjectStore {
  const [store] = useState(
    () => new ProjectStore({ settings: project.settings, beats: project.beats }, libraryPersistence(project.id)),
  );

  useEffect(() => {
    let cancelled = false;
    void getEdits(project.id)
      .catch((err) => {
        console.error('Loading note edits failed', err);
        return undefined;
      })
      .then((saved) => {
        if (!cancelled && !store.getState().editsLoaded) store.loadEdits(saved ?? EMPTY_EDITS);
      });
    const flush = () => store.flush(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [store, project.id]);

  return store;
}

/** The store's whole state; the component re-renders on every change. */
export function useProjectState(store: ProjectStore): ProjectState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

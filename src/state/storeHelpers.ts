import type { Project, Track } from '../music/types';

export function findTrack(project: Project, id: string): Track | undefined {
  return project.tracks.find((track) => track.id === id);
}

export function replaceTrack(project: Project, id: string, change: (track: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map((track) => (track.id === id ? change(track) : track)) };
}

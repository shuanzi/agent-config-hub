import { invoke } from './invoke';
import type { ProjectSummary } from '../../types';

export interface AddProjectInput {
  rootPath: string;
  displayName?: string;
}

export interface RelinkProjectRootInput {
  projectId: string;
  rootPath: string;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return invoke('list_projects');
}

export async function addProject(input: AddProjectInput): Promise<ProjectSummary> {
  return invoke('add_project', { ...input });
}

export async function relinkProjectRoot(input: RelinkProjectRootInput): Promise<ProjectSummary> {
  return invoke('relink_project_root', { ...input });
}

export async function removeProject(projectId: string): Promise<void> {
  return invoke('remove_project', { projectId });
}

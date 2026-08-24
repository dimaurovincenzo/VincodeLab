import { lazy } from 'react'
import { loadProjectInstructions, loadProjectSkills } from '@/features/ai'

export const TerminalWorkspace = lazy(() => import('@/features/terminal').then((module) => ({ default: module.TerminalWorkspace })))
export const ProjectEditor = lazy(() => import('@/features/editor').then((module) => ({ default: module.ProjectEditor })))
export const GitHubWorkspace = lazy(() => import('@/features/github').then((module) => ({ default: module.GitHubWorkspace })))
export const DatabaseWorkspace = lazy(() => import('@/features/database').then((module) => ({ default: module.DatabaseWorkspace })))
export const RedisWorkspace = lazy(() => import('@/features/redis').then((module) => ({ default: module.RedisWorkspace })))
export const AppSettings = lazy(() => import('@/features/settings').then((module) => ({ default: module.Settings })))
export const ProjectSkills = lazy(() => loadProjectSkills().then((module) => ({ default: module.ProjectSkills })))
export const ProjectInstructions = lazy(() => loadProjectInstructions().then((module) => ({ default: module.ProjectInstructions })))

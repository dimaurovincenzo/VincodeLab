import { lazy } from 'react'

const loadProjectInstructions = () => import('./project-instructions')
const loadProjectSkills = () => import('./project-skills')

export const ProjectSkills = lazy(() => loadProjectSkills().then((module) => ({ default: module.ProjectSkills })))
export const ProjectInstructions = lazy(() => loadProjectInstructions().then((module) => ({ default: module.ProjectInstructions })))

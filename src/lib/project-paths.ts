import { resolve } from 'node:path'

export function projectRoot() {
  return resolve(process.env.MCS_PROJECT_ROOT ?? resolve(process.cwd(), 'project'))
}

export function projectScenePath() {
  return resolve(projectRoot(), 'scene.json')
}

export function projectHistoryPath() {
  return resolve(projectRoot(), '.history')
}
